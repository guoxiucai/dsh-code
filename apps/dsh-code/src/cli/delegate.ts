/**
 * Launcher delegation. dsh-code does not reimplement DSH boot/shutdown/plugin
 * reconciliation: it resolves the upstream `@deepseek-ai/dsh` bin and spawns it
 * with the current Node executable, inheriting stdio and the process exit code.
 * @module dsh-code/cli/delegate
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/**
 * Resolve the upstream dsh launcher entry (`@deepseek-ai/dsh/lib/bin.js`) from
 * the installed dependencies. Resolving `package.json` (not an export) keeps
 * this robust whether or not the package later gains an `exports` map.
 */
export function resolveDshBin(): string {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

/**
 * Spawn the upstream launcher with the current Node executable, inheriting
 * stdio, and settle with the child's exit code (or a failure code when it
 * cannot be spawned at all).
 * @param dshArgs - argv for the upstream launcher (e.g. `['--profile', 'dsh-code']`).
 * @param env - process environment for the child (home isolation applied here).
 */
export function delegateDsh(dshArgs: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    let bin: string
    try {
      bin = resolveDshBin()
    } catch (error) {
      process.stderr.write(`dsh-code: cannot resolve @deepseek-ai/dsh: ${error instanceof Error ? error.message : String(error)}\n`)
      resolve(1)
      return
    }
    const child = spawn(process.execPath, [bin, ...dshArgs], { stdio: 'inherit', env })
    child.on('error', (error) => {
      process.stderr.write(`dsh-code: failed to launch dsh: ${error.message}\n`)
      resolve(1)
    })
    child.on('exit', (code, signal) => {
      if (signal !== null) resolve(signal === 'SIGINT' ? 130 : 1)
      else resolve(code ?? 1)
    })
  })
}
