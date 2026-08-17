import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  EventSequenceError,
  UnknownRequiredEventError,
  createReducerState,
  reduceSessionEvent,
  replayEvents,
} from '../../src/tui/reducer.ts'

/** Build a SessionEvent-shaped value for reducer tests (type cast only). */
function ev(type: string, seq: number, data: unknown, ignorable?: true): SessionEvent {
  const event = { type, seq, time: 1000 + seq, data }
  if (ignorable === true) Object.assign(event, { ignorable: true })
  return event as unknown as SessionEvent
}

const textDelta = (text: string): unknown => ({ turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } })
const assistantMessage = (text: string): unknown => ({
  turn: 1, step: 1,
  message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } },
})

describe('session event reducer', () => {
  it('EVT-001: merges assistant text deltas into one message', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('assistant/chunk', 1, textDelta('Hello')))
    s = reduceSessionEvent(s, ev('assistant/chunk', 2, textDelta(' world')))
    s = reduceSessionEvent(s, ev('assistant/message', 3, assistantMessage('Hello world')))
    const assistants = s.transcript.filter(item => item.kind === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ kind: 'assistant', text: 'Hello world' })
  })

  it('EVT-002: reasoning deltas are kept separate from the answer', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('assistant/chunk', 1, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } }))
    s = reduceSessionEvent(s, ev('assistant/message', 2, {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }, { type: 'reasoning', text: 'think' }], source: { kind: 'model', provider: 'p', model: 'm' } },
    }))
    expect(s.transcript).toHaveLength(1)
    expect(s.transcript[0]).toMatchObject({ kind: 'assistant', text: 'answer', reasoning: 'think' })
  })

  it('EVT-003: tool lifecycle runs from running to done', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('tool/call', 1, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }))
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'tool', name: 'bash', status: 'running' })
    s = reduceSessionEvent(s, ev('tool/result', 2, {
      turn: 1, step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: 'c1' } },
    }))
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'tool', status: 'done', resultText: 'ok' })
  })

  it('EVT-004: a tool error is not reported as success', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('tool/call', 1, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }))
    s = reduceSessionEvent(s, ev('tool/result', 2, {
      turn: 1, step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'boom' }], isError: true }], source: { kind: 'tool', callId: 'c1' } },
      error: { name: 'ExecError', code: 'E1' },
    }))
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'tool', status: 'error', errorCode: 'E1' })
  })

  it('EVT-005: a repeated seq is deduplicated', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    const length = s.transcript.length
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    expect(s.transcript).toHaveLength(length)
  })

  it('EVT-006: an out-of-order seq fails fast', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    expect(() => reduceSessionEvent(s, ev('assistant/chunk', 5, textDelta('x')))).toThrow(EventSequenceError)
  })

  it('EVT-007: replaying a log matches live application', () => {
    const events = [
      ev('turn/start', 0, { turn: 1 }),
      ev('user/message', 1, { role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
      ev('assistant/chunk', 2, textDelta('hey')),
      ev('assistant/message', 3, assistantMessage('hey')),
      ev('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const replayed = replayEvents('s1', events)
    let live = createReducerState('s1')
    for (const event of events) live = reduceSessionEvent(live, event)
    expect(live.transcript).toEqual(replayed.transcript)
    expect(live.phase).toBe('idle')
  })

  it('EVT-009: an unknown ignorable event is skipped', () => {
    const s = reduceSessionEvent(createReducerState('s1'), ev('future/info', 0, {}, true))
    expect(s.transcript).toHaveLength(0)
  })

  it('EVT-010: an unknown required event blocks the transcript', () => {
    expect(() => reduceSessionEvent(createReducerState('s1'), ev('future/required', 0, {}))).toThrow(UnknownRequiredEventError)
  })

  it('reports a failing turn end as a notice, not a success', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('turn/end', 1, { turn: 1, reason: { kind: 'error', error: { code: 'X', message: 'boom' } } }))
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'notice' })
  })

  it('tracks the approval phase (asked → decided)', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('approval/asked', 1, { id: 'a1', toolName: 'bash', reason: 'write outside workspace' }))
    expect(s.phase).toBe('waiting-approval')
    s = reduceSessionEvent(s, ev('approval/decided', 2, { id: 'a1', outcome: 'allowed-once' }))
    expect(s.phase).toBe('running')
  })

  it('skips known-but-unrendered events without crashing', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('command/run', 1, { commandId: 'c1', name: 'goal', source: { kind: 'user' } }))
    s = reduceSessionEvent(s, ev('permission/preset', 2, { preset: 'workspace-write' }))
    expect(s.transcript).toHaveLength(0)
    expect(s.lastSeq).toBe(2)
  })

  it('collapses injected context but keeps human prompts', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('user/message', 1, { role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    s = reduceSessionEvent(s, ev('user/message', 2, { role: 'user', content: [{ type: 'text', text: 'runtime snapshot' }], source: { kind: 'plugin', plugin: 'ctx', form: 'snapshot', sections: [] } }))
    expect(s.transcript).toEqual([{ kind: 'user', text: 'hello' }])
  })

  it('renders an injected notice as a notice row', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('user/message', 1, { role: 'user', content: [], source: { kind: 'plugin', plugin: 'watcher', form: 'notice', summary: 'file changed' } }))
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'notice', text: 'file changed' })
  })

  it('tracks the permission preset and plan mode', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('permission/preset', 1, { preset: 'danger-full-access' }))
    expect(s.permission).toBe('danger-full-access')
    s = reduceSessionEvent(s, ev('plan/mode', 2, { active: true }))
    expect(s.plan).toBe(true)
    s = reduceSessionEvent(s, ev('plan/mode', 3, { active: false }))
    expect(s.plan).toBe(false)
  })

  it('renders a command result as a notice', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('command/done', 1, { commandId: 'c1', kind: 'success', text: 'done' }))
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'notice', text: 'done' })
  })

  it('tracks a retry status and clears it when the retry starts', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('llm/retry', 1, { retryId: 'r1', turn: 1, step: 1, provider: 'p', mode: 'normal', policyKey: 'k', retry: 1, maxRetries: 3, delayMs: 2000, failure: { code: 'X', message: 'boom' } }))
    expect(s.retryStatus).toMatchObject({ retry: 1, maxRetries: 3, delayMs: 2000 })
    s = reduceSessionEvent(s, ev('llm/retry-started', 2, { retryId: 'r1', turn: 1, step: 1, retry: 1 }))
    expect(s.retryStatus).toBeUndefined()
  })

  it('tracks a compaction lifecycle', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('compaction/start', 0, { compactionId: 'c1', turn: null }))
    expect(s.compacting).toBe(true)
    s = reduceSessionEvent(s, ev('compaction/end', 1, { compactionId: 'c1', turn: null }))
    expect(s.compacting).toBe(false)
  })

  it('extracts file diffs from a write/edit tool result', () => {
    let s = createReducerState('s1')
    s = reduceSessionEvent(s, ev('turn/start', 0, { turn: 1 }))
    s = reduceSessionEvent(s, ev('tool/call', 1, { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: '{}' }))
    s = reduceSessionEvent(s, ev('tool/result', 2, {
      turn: 1, step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: 'c1' } },
      meta: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
    }))
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'tool', diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] })
  })
})
