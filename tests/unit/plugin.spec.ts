import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  shouldMeasureContextTokens,
  shouldDiscardEmptyFreshSession,
  STREAM_RENDER_INTERVAL_MS,
  userInputDelivery,
} from '../../src/tui/plugin.ts'

describe('TUI render scheduling', () => {
  it('keeps streamed draft chunks out of token-surface measurement', () => {
    expect(shouldMeasureContextTokens('assistant/chunk')).toBe(false)
    expect(shouldMeasureContextTokens('assistant/message')).toBe(true)
    expect(shouldMeasureContextTokens('tool/result')).toBe(true)
  })

  it('coalesces stream frames to approximately 30fps', () => {
    expect(STREAM_RENDER_INTERVAL_MS).toBeGreaterThanOrEqual(32)
    expect(STREAM_RENDER_INTERVAL_MS).toBeLessThanOrEqual(34)
  })
})

describe('empty fresh Session cleanup', () => {
  it('discards only a newly created Session with no human prompt', () => {
    const session = Session.create(SessionId('empty'))
    expect(shouldDiscardEmptyFreshSession(undefined, session.events)).toBe(true)
    expect(shouldDiscardEmptyFreshSession('empty', session.events)).toBe(false)
    expect(shouldDiscardEmptyFreshSession('empty', session.events, 'empty')).toBe(true)
    expect(shouldDiscardEmptyFreshSession('empty', session.events, 'another')).toBe(false)

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'keep me' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(shouldDiscardEmptyFreshSession(undefined, session.events)).toBe(false)
    expect(shouldDiscardEmptyFreshSession('empty', session.events, 'empty')).toBe(false)
  })
})

describe('TUI user input delivery', () => {
  it('steers a running parent while a child is active instead of queuing another turn', () => {
    expect(userInputDelivery('running', 1)).toBe('steer')
  })

  it('keeps ordinary input as a separate follow-up turn', () => {
    expect(userInputDelivery('idle', 1)).toBe('followup')
    expect(userInputDelivery('running', 0)).toBe('followup')
  })
})
