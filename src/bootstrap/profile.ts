/**
 * Initialize the fixed `dsh-code` profile under `~/.dsh-code/profiles/dsh-code`.
 * The profile stacks `@deepseek-ai/dsh-base` (the upstream shared core) with one
 * product interaction rows. The model-facing ask-user tool comes from DSH;
 * the terminal-host plugin is referenced by an absolute `file://` module URL
 * so the product's own TUI loads from the installed package without any
 * upstream boot-path change.
 * @module dsh-code/bootstrap/profile
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_SCHEMA, dump, load, Type } from 'js-yaml'
import { DEFAULT_AGENT_PRESET } from '../agent-mode.ts'
import { tuiBundleRestriction } from '../tui-bundle-policy.ts'

/** The profile name dsh-code boots. */
export const DSH_CODE_PROFILE_NAME = 'dsh-code'

export { DEFAULT_AGENT_PRESET } from '../agent-mode.ts'

/**
 * Model-facing rows supplied by dsh-base for a process-wide TUI agent. Once
 * that agent formally joins a preset these rows must come from the preset's
 * scoped composition instead, while their host-plane registries stay mounted.
 */
const PRESET_OWNED_BASE_ROWS = [
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'tool-str-replace-editor',
  'skill-filesystem',
  'tool-skill',
  'tool-goal',
  'command-goal',
  'plan-mode',
  'compaction-basic',
  'command-compact',
  'tool-result-pruner',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'workflow-ptc',
  'tool-workflow',
  'tool-ralph',
  'agent-instructions',
  'tool-todo',
  'tool-web',
] as const

/** Absolute profile directory under a given dsh-code home. */
export function profileDir(home: string): string {
  return join(home, 'profiles', DSH_CODE_PROFILE_NAME)
}

/** Reject competing app entrypoints before the picker or TUI starts; leave advanced CLI management available. */
export function tuiProfileConflict(home: string): string | undefined {
  const path = join(profileDir(home), 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dsh?: { profile?: { bundles?: unknown } } }
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return undefined // The upstream manifest reader diagnoses malformed configuration.
  const conflicts = bundles.filter((name): name is string => typeof name === 'string' && tuiBundleRestriction(name) !== undefined)
  return conflicts.length === 0 ? undefined
    : `Cannot start TUI: application bundles ${conflicts.join(', ')} conflict with the dsh-code profile. Remove them from dsh.profile.bundles in ${path}; use their separate profiles instead.`
}

/** The profile manifest body (bundles: upstream base only). */
function profileManifest(): string {
  return JSON.stringify({
    name: `dsh-profile-${DSH_CODE_PROFILE_NAME}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }, null, 2) + '\n'
}

/**
 * Read-only compatibility roots served by a second upstream filesystem-skill
 * provider. The normal dsh-base provider already owns project `.dsh` /
 * `.agents` and dsh-code's isolated `$DSH_HOME` (`~/.dsh-code`). These roots
 * add the conventional standalone DSH, Codex, and Claude locations without
 * importing any of those products' settings or management state.
 */
export function compatibleSkillDirs(projectRoot: string, userHome = homedir()): string[] {
  return [
    join(projectRoot, '.codex', 'skills'),
    join(projectRoot, '.claude', 'skills'),
    join(userHome, '.dsh', 'skills'),
    join(userHome, '.codex', 'skills'),
    join(userHome, '.claude', 'skills'),
  ]
}

/** Match the upstream filesystem provider's nearest-`.git` project boundary. */
export function skillProjectRoot(cwd: string): string {
  const start = resolve(cwd)
  let current = start
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

function profilePatch(tuiPluginUrl: string, projectRoot: string): string {
  const skillDirs = compatibleSkillDirs(skillProjectRoot(projectRoot))
  return `# dsh-code interaction layer over dsh-base.
# The TUI plugin is referenced by absolute module URL so it always loads from
# the installed dsh-code package, never from the upstream installation.
${PRESET_OWNED_BASE_ROWS.map(id => `- id: ${id}\n  disabled: true`).join('\n\n')}

- insert:
    # Definitions below reuse the upstream's shipped declarative presets.
    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: ${DEFAULT_AGENT_PRESET}

    # DSH 0.1.2 presets expose per-subagent model selection and require this
    # Host-scoped settings provider before their delegated tools are mounted.
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'

    # Discovery only: a second upstream provider reads compatible skill roots.
    # dsh-code never installs, deletes, or copies skills from these products.
    - id: dsh-code-compatible-skills
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: dsh-code-compatible-filesystem
        includeDefaultRoots: false
        customSkillDirs: ${JSON.stringify(skillDirs)}

    - id: dsh-code-tui
      name: ${JSON.stringify(tuiPluginUrl)}

${['standard', 'ptc'].map(id => readFileSync(createRequire(import.meta.url).resolve(`@deepseek-ai/dsh-web-app/presets/${id}.patch.yml`), 'utf8')).join('\n')}
`
}

// Retain upstream !!js expressions while refreshing only product-owned rows.
class ConfigExpression {
  constructor(readonly expression: string) {}
}
const PATCH_SCHEMA = DEFAULT_SCHEMA.extend(new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: value => new ConfigExpression(String(value)),
  instanceOf: ConfigExpression,
  represent: value => (value as ConfigExpression).expression,
}))

function retainedProfilePatch(path: string): string {
  if (!existsSync(path)) return ''
  const rows: unknown = load(readFileSync(path, 'utf8'), { schema: PATCH_SCHEMA })
  if (!Array.isArray(rows)) throw new Error(`profile patch must be a YAML sequence: ${path}`)
  const owned = new Set([
    'agent-presets', 'agent-preset-registry', 'subagent-model-selection-settings',
    'dsh-code-compatible-skills', 'dsh-code-tool-ask-user', 'dsh-code-tui',
    'preset-standard', 'preset-ptc',
  ])
  const retained = rows.flatMap((row: Record<string, unknown>) => {
    if (Array.isArray(row.insert)) {
      const insert = row.insert.filter((entry: { id?: string }) => !owned.has(entry.id ?? ''))
      return insert.length === 0 ? [] : [{ ...row, insert }]
    }
    if (PRESET_OWNED_BASE_ROWS.some(id => row.id === id)
      && row.disabled === true && Object.keys(row).length === 2) return []
    return [row]
  })
  return retained.length === 0 ? '' : dump(retained, { schema: PATCH_SCHEMA, lineWidth: -1, noRefs: true })
}

/** pnpm settings for out-of-tree plugins installed into the profile directory. */
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/**
 * Initialize (or refresh) the dsh-code profile directory. The manifest is
 * created only when absent; generated rows are refreshed while profile config
 * overrides (including upstream settings writes) survive every launch.
 * @param home - the dsh-code home.
 * @param tuiPluginUrl - absolute `file://` module URL of the built TUI plugin.
 */
export function initDshCodeProfile(home: string, tuiPluginUrl: string, projectRoot = process.cwd()): string {
  const dir = profileDir(home)
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) writeFileSync(manifestPath, profileManifest())
  const patchPath = join(dir, 'cordis.patch.yml')
  const overrides = retainedProfilePatch(patchPath)
  writeFileSync(patchPath, profilePatch(tuiPluginUrl, projectRoot) + overrides, { mode: 0o600 })
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
  return dir
}
