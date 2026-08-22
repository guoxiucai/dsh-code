/**
 * dsh-code-only skill switches. Preferences live under the isolated DSH_HOME
 * and are applied as an agent-scoped shadow provider, so source SKILL.md files
 * and separately installed DSH/Codex/Claude products are never modified.
 * @module dsh-code/tui/skill-preferences
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'

export const DISABLED_SKILL_PROVIDER = 'dsh-code-disabled-skills'

export interface DisabledSkillRecord {
  name: string
  description: string
  source: string
  location: string
  userInvocable?: boolean
  modelInvocable?: boolean
}

interface SkillPreferencesDocument {
  disabled: DisabledSkillRecord[]
}

export function skillPreferencesPath(home: string): string {
  return join(home, 'skill-preferences.json')
}

function validRecord(value: unknown): value is DisabledSkillRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.name)
    && typeof record.description === 'string'
    && typeof record.source === 'string'
    && typeof record.location === 'string'
    && (record.userInvocable === undefined || typeof record.userInvocable === 'boolean')
    && (record.modelInvocable === undefined || typeof record.modelInvocable === 'boolean')
}

export function readDisabledSkills(home: string): Map<string, DisabledSkillRecord> {
  const path = skillPreferencesPath(home)
  if (!existsSync(path)) return new Map()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SkillPreferencesDocument>
    const records = Array.isArray(parsed.disabled) ? parsed.disabled.filter(validRecord) : []
    return new Map(records.map(record => [record.name, record]))
  } catch {
    return new Map()
  }
}

export function writeDisabledSkills(home: string, records: ReadonlyMap<string, DisabledSkillRecord>): void {
  const path = skillPreferencesPath(home)
  mkdirSync(dirname(path), { recursive: true })
  const document: SkillPreferencesDocument = {
    disabled: [...records.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

/** Build the scoped provider whose non-invocable entries shadow global skills. */
export function createDisabledSkillProvider(records: ReadonlyMap<string, DisabledSkillRecord>): SkillProvider {
  const candidate = (record: DisabledSkillRecord): SkillCandidate => ({
    name: record.name,
    description: record.description,
    invocation: { modelInvocable: false, userInvocable: false },
    source: 'dsh-code-disabled',
    provider: DISABLED_SKILL_PROVIDER,
    resourceBase: { kind: 'opaque', description: record.location },
    rank: 0,
    locator: record.name,
  })
  return {
    name: DISABLED_SKILL_PROVIDER,
    async list() {
      return [...records.values()].map(candidate)
    },
    async get(entry): Promise<SkillDefinition | undefined> {
      const record = records.get(entry.name)
      if (record === undefined) return undefined
      return { ...candidate(record), content: 'Disabled for dsh-code.' }
    },
  }
}

/** Install the dsh-code shadow provider into one Agent's scope. */
export async function installDisabledSkillProvider(
  agentCtx: Context,
  records: ReadonlyMap<string, DisabledSkillRecord>,
  onControl: (control: SkillProviderControl) => void,
): Promise<void> {
  await agentCtx.plugin({
    inject: ['skills'],
    apply(scopedCtx: Context) {
      scopedCtx.skills.registerProvider((control) => {
        onControl(control)
        return createDisabledSkillProvider(records)
      })
    },
  })
}
