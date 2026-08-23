/**
 * Compatibility preload for the published DSH rc runtime. Its first PTC call
 * uses Node's experimental TypeScript wrapper, whose process-level warning
 * bypasses session events and corrupts the alternate-screen TUI. Match only
 * that exact warning; every other warning keeps Node's normal behavior.
 */

const TYPE_STRIP_WARNING = 'stripTypeScriptTypes is an experimental feature and might change at any time'
const originalEmitWarning = process.emitWarning

process.emitWarning = function filteredEmitWarning(this: NodeJS.Process, ...args: unknown[]): void {
  const warning = args[0]
  const message = warning instanceof Error ? warning.message : warning
  const type = warning instanceof Error ? warning.name : args[1]
  if (message === TYPE_STRIP_WARNING && type === 'ExperimentalWarning') return
  Reflect.apply(originalEmitWarning, this, args)
} as typeof process.emitWarning
