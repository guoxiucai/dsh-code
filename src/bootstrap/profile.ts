/**
 * Initialize the fixed `dsh-code` profile under `~/.dsh-code/profiles/dsh-code`.
 * The profile stacks `@deepseek-ai/dsh-base` (the upstream shared core) with one
 * product interaction rows. The model-facing ask-user tool comes from DSH;
 * the terminal-host plugin is referenced by an absolute `file://` module URL
 * so the product's own TUI loads from the installed package without any
 * upstream boot-path change.
 * @module dsh-code/bootstrap/profile
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The profile name dsh-code boots. */
export const DSH_CODE_PROFILE_NAME = 'dsh-code'

/** Absolute profile directory under a given dsh-code home. */
export function profileDir(home: string): string {
  return join(home, 'profiles', DSH_CODE_PROFILE_NAME)
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

/** The profile patch layer: DSH ask-user tool plus the terminal-host plugin. */
function profilePatch(tuiPluginUrl: string): string {
  return `# dsh-code interaction layer over dsh-base.
# The TUI plugin is referenced by absolute module URL so it always loads from
# the installed dsh-code package, never from the upstream installation.
- insert:
    - id: dsh-code-tool-ask-user
      name: '@deepseek-ai/dsh-tool-ask-user'

    - id: dsh-code-tui
      name: ${JSON.stringify(tuiPluginUrl)}
`
}

/** pnpm settings for out-of-tree plugins installed into the profile directory. */
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/**
 * Initialize (or refresh) the dsh-code profile directory. The manifest is
 * created only when absent; the patch layer is rewritten each launch so it
 * tracks the current install location, and the pnpm workspace file is written
 * only when absent.
 * @param home - the dsh-code home.
 * @param tuiPluginUrl - absolute `file://` module URL of the built TUI plugin.
 */
export function initDshCodeProfile(home: string, tuiPluginUrl: string): string {
  const dir = profileDir(home)
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) writeFileSync(manifestPath, profileManifest())
  writeFileSync(join(dir, 'cordis.patch.yml'), profilePatch(tuiPluginUrl))
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
  return dir
}
