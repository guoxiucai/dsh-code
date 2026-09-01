import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { delegateInteractiveProcess } from '../../src/cli/delegate.ts'
import {
  isSessionDiscardMessage,
  isSessionSwitchMessage,
  sessionSwitchBlocker,
} from '../../src/session-switch.ts'

const fixture = fileURLToPath(new URL('../fixtures/session-switch-child.mjs', import.meta.url))

describe('session switch IPC', () => {
  it('accepts only valid tagged transition targets', () => {
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', target: { kind: 'resume', sessionId: 'session-1' } })).toBe(true)
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', target: { kind: 'new' } })).toBe(true)
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', target: { kind: 'picker', fallbackSessionId: 'session-1' } })).toBe(true)
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', target: { kind: 'web', fallbackSessionId: 'session-1', discardIfStillEmpty: false } })).toBe(true)
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', target: { kind: 'resume', sessionId: '' } })).toBe(false)
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', target: { kind: 'web', fallbackSessionId: '', discardIfStillEmpty: false } })).toBe(false)
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', target: { kind: 'web', fallbackSessionId: 'session-1' } })).toBe(false)
    expect(isSessionSwitchMessage({ type: 'dsh-code/session-switch', target: { kind: 'unknown' } })).toBe(false)
    expect(isSessionSwitchMessage({ type: 'other', target: { kind: 'resume', sessionId: 'session-1' } })).toBe(false)
    expect(isSessionSwitchMessage(null)).toBe(false)
    expect(isSessionDiscardMessage({ type: 'dsh-code/session-discard', sessionId: 'session-empty' })).toBe(true)
    expect(isSessionDiscardMessage({ type: 'dsh-code/session-discard', sessionId: '' })).toBe(false)
  })

  it('returns every valid transition only after the child exits', async () => {
    await expect(delegateInteractiveProcess(fixture, ['resume'], process.env)).resolves.toEqual({
      code: 0,
      switchTarget: { kind: 'resume', sessionId: 'session-target' },
    })
    await expect(delegateInteractiveProcess(fixture, ['new'], process.env)).resolves.toEqual({
      code: 0,
      switchTarget: { kind: 'new' },
    })
    await expect(delegateInteractiveProcess(fixture, ['picker'], process.env)).resolves.toEqual({
      code: 0,
      switchTarget: { kind: 'picker', fallbackSessionId: 'session-current' },
    })
    await expect(delegateInteractiveProcess(fixture, ['web'], process.env)).resolves.toEqual({
      code: 0,
      switchTarget: { kind: 'web', fallbackSessionId: 'session-current', discardIfStillEmpty: false },
    })
    await expect(delegateInteractiveProcess(fixture, ['discard'], process.env)).resolves.toEqual({
      code: 0,
      discardSessionId: 'session-empty',
    })
    await expect(delegateInteractiveProcess(fixture, ['resume-discard'], process.env)).resolves.toEqual({
      code: 0,
      switchTarget: { kind: 'resume', sessionId: 'session-target' },
      discardSessionId: 'session-empty',
    })
  })

  it('ignores malformed requests and preserves the exit code', async () => {
    await expect(delegateInteractiveProcess(fixture, ['invalid'], process.env)).resolves.toEqual({ code: 0 })
    await expect(delegateInteractiveProcess(fixture, ['failed'], process.env)).resolves.toEqual({ code: 7 })
    await expect(delegateInteractiveProcess(fixture, ['valid-failed'], process.env)).resolves.toEqual({ code: 7 })
  })
})

describe('session switch gate', () => {
  it('blocks every activity that would be orphaned by process handoff', () => {
    expect(sessionSwitchBlocker({ agentRunning: true, queuedMessages: 0, liveJobs: 0, activeSubagents: 0 })).toContain('active turn')
    expect(sessionSwitchBlocker({ agentRunning: false, queuedMessages: 1, liveJobs: 0, activeSubagents: 0 })).toContain('queued messages')
    expect(sessionSwitchBlocker({ agentRunning: false, queuedMessages: 0, liveJobs: 0, activeSubagents: 1 })).toContain('subagents')
    expect(sessionSwitchBlocker({ agentRunning: false, queuedMessages: 0, liveJobs: 1, activeSubagents: 0 })).toContain('background jobs')
    expect(sessionSwitchBlocker({ agentRunning: false, queuedMessages: 0, liveJobs: 0, activeSubagents: 0 })).toBeUndefined()
  })
})
