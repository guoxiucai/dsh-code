import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActiveSubagentProjection } from '../../src/tui/active-subagent-projection.ts'

function child(id: string, label?: string): SubagentDescendantListEntry {
  return {
    kind: 'child',
    id,
    mode: 'one-shot',
    activity: 'running',
    hasChildren: false,
    parentId: 'root',
    depth: 1,
    ...(label === undefined ? {} : { label }),
  } as unknown as SubagentDescendantListEntry
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('active subagent projection', () => {
  it('publishes a lifecycle row immediately and enriches it when its descriptor arrives', async () => {
    let descriptors: readonly SubagentDescendantListEntry[] = []
    const projection = createActiveSubagentProjection({
      loadDescriptors: async () => descriptors,
      onChange: () => {},
      onBackgroundError: () => {},
    })

    projection.record({ type: 'started', runId: 'run-1', id: 'child-1' })
    expect(projection.current.count).toBe(1)
    expect(projection.current.rows).toEqual([{ id: 'child-1' }])
    expect(projection.current.rows[0]?.descriptor).toBeUndefined()

    descriptors = [child('child-1', 'Explore tests')]
    const snapshot = await projection.refresh()
    expect(snapshot.count).toBe(snapshot.rows.length)
    expect(snapshot.rows[0]?.descriptor?.label).toBe('Explore tests')
    projection.dispose()
  })

  it('counts duplicate runs for one child once and removes only the last ending run', () => {
    const projection = createActiveSubagentProjection({
      loadDescriptors: async () => [],
      onChange: () => {},
      onBackgroundError: () => {},
    })

    projection.record({ type: 'started', runId: 'run-1', id: 'child-1' })
    projection.record({ type: 'started', runId: 'run-2', id: 'child-1' })
    expect(projection.current.count).toBe(1)

    projection.record({ type: 'ended', runId: 'run-1', id: 'child-1' })
    expect(projection.current.count).toBe(1)
    projection.record({ type: 'ended', runId: 'run-2', id: 'child-1' })
    expect(projection.current).toEqual({ count: 0, rows: [] })
    projection.dispose()
  })

  it('keeps distinct child sessions active at the same time', () => {
    const projection = createActiveSubagentProjection({
      loadDescriptors: async () => [],
      onChange: () => {},
      onBackgroundError: () => {},
    })

    projection.record({ type: 'started', runId: 'run-1', id: 'child-1' })
    projection.record({ type: 'started', runId: 'run-2', id: 'child-2' })

    expect(projection.current.count).toBe(2)
    expect(projection.current.rows.map(row => row.id)).toEqual(['child-1', 'child-2'])
    projection.dispose()
  })

  it('dismisses only the presentation row and reveals a later run without stale details', async () => {
    let descriptors: readonly SubagentDescendantListEntry[] = [child('child-1', 'old run')]
    const projection = createActiveSubagentProjection({
      loadDescriptors: async () => descriptors,
      onChange: () => {},
      onBackgroundError: () => {},
    })

    projection.record({ type: 'started', runId: 'run-1', id: 'child-1' })
    await projection.refresh()
    expect(projection.current.rows[0]?.descriptor?.label).toBe('old run')
    projection.record({ type: 'dismissed', id: 'child-1' })
    expect(projection.current.count).toBe(0)

    descriptors = [child('child-1', 'new run')]
    projection.record({ type: 'started', runId: 'run-2', id: 'child-1' })
    expect(projection.current.rows.map(row => row.id)).toEqual(['child-1'])
    expect(projection.current.rows[0]?.descriptor).toBeUndefined()
    await projection.refresh()
    expect(projection.current.rows[0]?.descriptor?.label).toBe('new run')
    projection.dispose()
  })

  it('discards an older descriptor read that finishes after a newer one', async () => {
    const first = deferred<readonly SubagentDescendantListEntry[]>()
    const second = deferred<readonly SubagentDescendantListEntry[]>()
    const loadDescriptors = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const projection = createActiveSubagentProjection({
      loadDescriptors,
      onChange: () => {},
      onBackgroundError: () => {},
    })

    projection.record({ type: 'started', runId: 'run-1', id: 'child-1' })
    const latestRefresh = projection.refresh()
    second.resolve([child('child-1', 'new')])
    await latestRefresh
    first.resolve([child('child-1', 'old')])
    await first.promise

    expect(projection.current.rows[0]?.descriptor?.label).toBe('new')
    projection.dispose()
  })

  it('retries a descriptor that lags behind its lifecycle start', async () => {
    vi.useFakeTimers()
    const loadDescriptors = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([child('child-1')])
    const projection = createActiveSubagentProjection({
      loadDescriptors,
      onChange: () => {},
      onBackgroundError: () => {},
    })

    projection.record({ type: 'started', runId: 'run-1', id: 'child-1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(projection.current.rows[0]?.descriptor).toBeUndefined()

    await vi.advanceTimersByTimeAsync(50)
    expect(projection.current.rows[0]?.descriptor?.id).toBe('child-1')
    expect(loadDescriptors).toHaveBeenCalledTimes(2)
    projection.dispose()
  })

  it('ignores a descriptor read that resolves after disposal', async () => {
    const pending = deferred<readonly SubagentDescendantListEntry[]>()
    const onChange = vi.fn()
    const projection = createActiveSubagentProjection({
      loadDescriptors: () => pending.promise,
      onChange,
      onBackgroundError: () => {},
    })

    projection.record({ type: 'started', runId: 'run-1', id: 'child-1' })
    expect(onChange).toHaveBeenCalledTimes(1)
    projection.dispose()
    pending.resolve([child('child-1')])
    await pending.promise

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(projection.current.rows[0]?.descriptor).toBeUndefined()
  })
})
