import { describe, expect, it } from 'vitest'
import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
import {
  activeSubagentCount,
  shouldMeasureContextTokens,
  STREAM_RENDER_INTERVAL_MS,
  subagentEntriesForList,
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

describe('subagent list lifecycle', () => {
  it('counts a lifecycle start before its durable descriptor can be listed', () => {
    const activeRuns = new Map([['run-1', 'child-1']])
    expect(activeSubagentCount(activeRuns)).toBe(1)
    expect(activeSubagentCount(activeRuns, new Set(['child-1']))).toBe(0)
  })

  it('contains only active runs and drops completed descriptors', () => {
    const entries = [
      { kind: 'child', id: 'done', mode: 'one-shot', activity: 'inactive', hasChildren: false, parentId: 'root', depth: 1 },
      { kind: 'child', id: 'running', mode: 'one-shot', activity: 'running', hasChildren: false, parentId: 'root', depth: 1 },
    ] as unknown as SubagentDescendantListEntry[]
    expect(subagentEntriesForList(entries, new Set(['running'])).map(entry => String(entry.id))).toEqual(['running'])
    expect(subagentEntriesForList(entries, new Set(['running']), new Set(['running']))).toEqual([])
  })
})
