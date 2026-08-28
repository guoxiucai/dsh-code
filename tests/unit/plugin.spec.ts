import { describe, expect, it } from 'vitest'
import {
  shouldMeasureContextTokens,
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

describe('TUI user input delivery', () => {
  it('steers a running parent while a child is active instead of queuing another turn', () => {
    expect(userInputDelivery('running', 1)).toBe('steer')
  })

  it('keeps ordinary input as a separate follow-up turn', () => {
    expect(userInputDelivery('idle', 1)).toBe('followup')
    expect(userInputDelivery('running', 0)).toBe('followup')
  })
})
