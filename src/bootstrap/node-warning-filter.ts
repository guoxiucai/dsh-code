/**
 * Compatibility preload for the published DSH rc runtime. Its first PTC call
 * uses Node's experimental TypeScript wrapper, whose process-level warning
 * bypasses session events and corrupts the alternate-screen TUI. On Windows,
 * the same runtime also passes its absolute worker path to Node's ESM loader
 * as a string. Normalize only that upstream worker entry to a file URL.
 */

import { createRequire, syncBuiltinESMExports } from 'node:module'
import { win32 } from 'node:path'
import { pathToFileURL } from 'node:url'

type WorkerConstructor = typeof import('node:worker_threads').Worker

const require = createRequire(import.meta.url)

/** True only for the pinned upstream runtime's built worker entry on Windows. */
export function isWindowsPtcWorkerPath(filename: unknown, platform = process.platform): filename is string {
  if (platform !== 'win32' || typeof filename !== 'string' || !win32.isAbsolute(filename)) return false
  const normalized = filename.replaceAll('\\', '/').toLowerCase()
  return normalized.includes('/@deepseek-ai/dsh-code-runtime-worker-thread/') && normalized.endsWith('/lib/worker.cjs')
}

function installWindowsPtcWorkerCompatibility(): void {
  if (process.platform !== 'win32') return
  const workerThreads = require('node:worker_threads') as typeof import('node:worker_threads')
  const OriginalWorker = workerThreads.Worker
  class DshCodeWorker extends OriginalWorker {
    constructor(filename: string | URL, options?: ConstructorParameters<WorkerConstructor>[1]) {
      super(isWindowsPtcWorkerPath(filename) ? pathToFileURL(filename) : filename, options)
    }
  }
  Object.defineProperty(workerThreads, 'Worker', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: DshCodeWorker,
  })
  syncBuiltinESMExports()
}

installWindowsPtcWorkerCompatibility()

const TYPE_STRIP_WARNING = 'stripTypeScriptTypes is an experimental feature and might change at any time'
const originalEmitWarning = process.emitWarning

process.emitWarning = function filteredEmitWarning(this: NodeJS.Process, ...args: unknown[]): void {
  const warning = args[0]
  const message = warning instanceof Error ? warning.message : warning
  const type = warning instanceof Error ? warning.name : args[1]
  if (message === TYPE_STRIP_WARNING && type === 'ExperimentalWarning') return
  Reflect.apply(originalEmitWarning, this, args)
} as typeof process.emitWarning
