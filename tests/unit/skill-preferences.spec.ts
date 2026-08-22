import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import {
  createDisabledSkillProvider,
  installDisabledSkillProvider,
  readDisabledSkills,
  skillPreferencesPath,
  writeDisabledSkills,
  type DisabledSkillRecord,
} from '../../src/tui/skill-preferences.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('skill-preferences', () => {
  it('persists disabled skills only beneath the supplied dsh-code home', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-skills-'))
    dirs.push(home)
    const entry: DisabledSkillRecord = { name: 'grill-me', description: 'Ask hard questions', source: 'custom', location: '/skills/grill-me' }
    writeDisabledSkills(home, new Map([[entry.name, entry]]))
    expect(skillPreferencesPath(home).startsWith(home)).toBe(true)
    expect(readDisabledSkills(home).get('grill-me')).toEqual(entry)
  })

  it('shadows disabled skills as neither model nor user invocable', async () => {
    const entry: DisabledSkillRecord = { name: 'grill-me', description: 'Ask hard questions', source: 'custom', location: '/skills/grill-me' }
    const provider = createDisabledSkillProvider(new Map([[entry.name, entry]]))
    const candidates = await provider.list({})
    expect(Array.isArray(candidates) && candidates[0]?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    if (!Array.isArray(candidates) || candidates[0] === undefined) throw new Error('candidate missing')
    expect((await provider.get(candidates[0], {}))?.content).toContain('Disabled')
  })

  it('installs through an injected child while retaining the Agent scope', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const agentFiber = ctx.plugin(() => {})
    const agentScope = createScope(agentFiber.ctx, {}).ctx
    const controls: unknown[] = []
    const entry: DisabledSkillRecord = { name: 'agent-only', description: 'Scoped', source: 'custom', location: '/agent-only' }
    await expect(installDisabledSkillProvider(agentScope, new Map([[entry.name, entry]]), control => controls.push(control))).resolves.toBeUndefined()
    expect(controls).toHaveLength(1)
    expect(await ctx.skills.list()).toEqual([])
    expect((await ctx.skills.list({ scope: scopeOf(agentScope) })).map(skill => skill.name)).toEqual(['agent-only'])
    await agentFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('tolerates a malformed preferences document', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-skills-'))
    dirs.push(home)
    expect(readDisabledSkills(home)).toEqual(new Map())
  })
})
