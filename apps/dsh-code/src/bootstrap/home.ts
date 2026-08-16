/**
 * Independent `dsh-code` home isolation. dsh-code never reuses an existing
 * `DSH_HOME`: it resolves its own root from `DSH_CODE_HOME` (test/enterprise
 * override) or `~/.dsh-code`, then sets `DSH_HOME` to that path before
 * delegating to the upstream launcher.
 * @module dsh-code/bootstrap/home
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory name for the default dsh-code home under the OS home. */
export const DSH_CODE_HOME_DIR_NAME = '.dsh-code'

/** Environment variable that overrides the default dsh-code home. */
export const DSH_CODE_HOME_ENV = 'DSH_CODE_HOME'

/** Expand a leading `~`, `~/`, or `~\` prefix against the OS home. */
function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the dsh-code home. Precedence: `DSH_CODE_HOME` (non-blank) → `~/.dsh-code`.
 * @param env - environment mapping used to read `DSH_CODE_HOME`; defaults to `process.env`.
 * @returns the normalized absolute home path.
 */
export function resolveDshCodeHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[DSH_CODE_HOME_ENV]
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0
    ? fromEnv
    : join(homedir(), DSH_CODE_HOME_DIR_NAME)
  return resolve(expandHome(selected))
}

/** Join path segments onto the resolved dsh-code home. */
export function dshCodeHomePath(...segments: string[]): string {
  return join(resolveDshCodeHome(), ...segments)
}
