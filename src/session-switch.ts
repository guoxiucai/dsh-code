/** Process-local protocol used to hand a TUI session transition to the launcher. */

export const SESSION_SWITCH_MESSAGE_TYPE = 'dsh-code/session-switch' as const
export const SESSION_DISCARD_MESSAGE_TYPE = 'dsh-code/session-discard' as const

/** The launcher action requested after the current TUI has flushed and exited. */
export type SessionSwitchTarget =
  | { kind: 'resume'; sessionId: string }
  | { kind: 'new' }
  | { kind: 'picker'; fallbackSessionId: string }
  | { kind: 'web'; fallbackSessionId: string; discardIfStillEmpty: boolean }

export interface SessionSwitchMessage {
  type: typeof SESSION_SWITCH_MESSAGE_TYPE
  target: SessionSwitchTarget
}

export interface SessionDiscardMessage {
  type: typeof SESSION_DISCARD_MESSAGE_TYPE
  sessionId: string
}

/** Accept only the narrow message shape emitted by the dsh-code TUI child. */
export function isSessionSwitchMessage(value: unknown): value is SessionSwitchMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.type !== SESSION_SWITCH_MESSAGE_TYPE || typeof record.target !== 'object' || record.target === null) {
    return false
  }
  const target = record.target as Record<string, unknown>
  if (target.kind === 'new') return true
  if (target.kind === 'resume') return typeof target.sessionId === 'string' && target.sessionId.trim() !== ''
  if (target.kind === 'web') {
    return typeof target.fallbackSessionId === 'string'
      && target.fallbackSessionId.trim() !== ''
      && typeof target.discardIfStillEmpty === 'boolean'
  }
  return target.kind === 'picker'
    && typeof target.fallbackSessionId === 'string'
    && target.fallbackSessionId.trim() !== ''
}

/** Accept only a non-empty session id emitted by the empty-session cleanup path. */
export function isSessionDiscardMessage(value: unknown): value is SessionDiscardMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.type === SESSION_DISCARD_MESSAGE_TYPE
    && typeof record.sessionId === 'string'
    && record.sessionId.trim() !== ''
}

/** Send one validated internal message over the launcher's private IPC channel. */
function sendLauncherMessage(message: SessionSwitchMessage | SessionDiscardMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined) {
      reject(new Error('session switching is unavailable outside the dsh-code launcher'))
      return
    }
    process.send(message, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
}

/** Ask the launcher parent to perform a session transition after this TUI exits. */
export function sendSessionSwitch(target: SessionSwitchTarget): Promise<void> {
  return sendLauncherMessage({ type: SESSION_SWITCH_MESSAGE_TYPE, target })
}

/** Ask the launcher to remove an empty fresh Session after this TUI exits. */
export function sendSessionDiscard(sessionId: string): Promise<void> {
  return sendLauncherMessage({ type: SESSION_DISCARD_MESSAGE_TYPE, sessionId })
}

/** Explain why a live session cannot safely be handed to another process yet. */
export function sessionSwitchBlocker(input: {
  agentRunning: boolean
  queuedMessages: number
  liveJobs: number
  activeSubagents: number
}): string | undefined {
  if (input.agentRunning) return 'interrupt the active turn before switching sessions (Esc)'
  if (input.queuedMessages > 0) return 'wait for queued messages to finish before switching sessions'
  if (input.activeSubagents > 0) return 'wait for or cancel active subagents before switching sessions'
  if (input.liveJobs > 0) return 'stop active background jobs before switching sessions'
  return undefined
}
