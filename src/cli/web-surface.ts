/**
 * Deep launcher module for one exclusive Web-surface lease. Callers provide
 * environment and trusted patch args; process boot, readiness, terminal
 * parking, stop controls, and signal cleanup stay behind this interface.
 * @module dsh-code/cli/web-surface
 */

import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { delegateDshWeb, type WebDelegateHandle } from './delegate.ts'
import { WebParkedHost } from './web-parked-host.ts'

export interface RunWebSurfaceOptions {
  env: NodeJS.ProcessEnv
  patchArgs?: readonly string[]
}

export interface WebSurfaceResult {
  code: number
  readyUrl?: string
  exitRequested: boolean
  stopRequested: boolean
  diagnostics: readonly string[]
}

/** Run Web until upstream exits or the parked terminal requests a transition. */
export async function runWebSurface(options: RunWebSurfaceOptions): Promise<WebSurfaceResult> {
  let delegate: WebDelegateHandle | undefined
  let exitRequested = false
  let transitionRequested = false

  const requestStop = (exit: boolean): void => {
    if (transitionRequested) return
    transitionRequested = true
    exitRequested = exit
    host.stopping()
    delegate?.stop()
  }
  const host = new WebParkedHost({
    onReturn: () => { requestStop(false) },
    onExit: () => { requestStop(true) },
  })
  const onSignal = (): void => { requestStop(true) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  host.start()
  try {
    delegate = delegateDshWeb({
      env: options.env,
      ...(options.patchArgs === undefined ? {} : { patchArgs: options.patchArgs }),
      onReady: url => { host.ready(url) },
      onDiagnostic: line => { host.diagnostic(stripTerminalSequences(line)) },
    })
    // Esc or a signal can arrive in the tiny interval between parking the TUI
    // and assigning the process handle. Honor that already-recorded request.
    if (transitionRequested) delegate.stop()
    const result = await delegate.result
    return { ...result, exitRequested }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    host.stop()
  }
}
