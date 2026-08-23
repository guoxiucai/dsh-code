/** Process-local protocol used to hand a TUI session switch to the launcher. */

export const SESSION_SWITCH_MESSAGE_TYPE = 'dsh-code/session-switch' as const

export interface SessionSwitchMessage {
  type: typeof SESSION_SWITCH_MESSAGE_TYPE
  sessionId: string
}

/** Accept only the narrow message shape emitted by the dsh-code TUI child. */
export function isSessionSwitchMessage(value: unknown): value is SessionSwitchMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.type === SESSION_SWITCH_MESSAGE_TYPE
    && typeof record.sessionId === 'string'
    && record.sessionId.trim() !== ''
}

/** Ask the launcher parent to restart the TUI on another persisted session. */
export function sendSessionSwitch(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined) {
      reject(new Error('session switching is unavailable outside the dsh-code launcher'))
      return
    }
    const message: SessionSwitchMessage = { type: SESSION_SWITCH_MESSAGE_TYPE, sessionId }
    process.send(message, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
}
