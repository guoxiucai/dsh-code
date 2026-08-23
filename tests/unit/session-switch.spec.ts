import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { delegateInteractiveProcess } from '../../src/cli/delegate.ts'
import { isSessionSwitchMessage } from '../../src/session-switch.ts'

const fixture = fileURLToPath(new URL('../fixtures/session-switch-child.mjs', import.meta.url))

describe('session switch IPC', () => {
  it('accepts only a non-empty, tagged request', () => {
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', sessionId: 'session-1' })).toBe(true)
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', sessionId: '' })).toBe(false)
    expect(isSessionSwitchMessage({ type: 'other', sessionId: 'session-1' })).toBe(false)
    expect(isSessionSwitchMessage(null)).toBe(false)
  })

  it('returns a valid request only after the child exits', async () => {
    await expect(delegateInteractiveProcess(fixture, ['valid'], process.env)).resolves.toEqual({
      code: 0,
      switchSessionId: 'session-target',
    })
  })

  it('ignores malformed requests and preserves the exit code', async () => {
    await expect(delegateInteractiveProcess(fixture, ['invalid'], process.env)).resolves.toEqual({ code: 0 })
    await expect(delegateInteractiveProcess(fixture, ['failed'], process.env)).resolves.toEqual({ code: 7 })
    await expect(delegateInteractiveProcess(fixture, ['valid-failed'], process.env)).resolves.toEqual({ code: 7 })
  })
})
