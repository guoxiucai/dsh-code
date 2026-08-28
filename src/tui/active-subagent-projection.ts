/**
 * Disposable TUI projection of active subagent lifecycle edges. Lifecycle
 * events decide which children are active; durable descriptors only enrich
 * those rows once they become readable.
 * @module dsh-code/tui/active-subagent-projection
 */

import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'

export type ActiveSubagentDescriptor = Extract<SubagentDescendantListEntry, { readonly kind: 'child' }>

export interface ActiveSubagentRow {
  readonly id: string
  /** Missing while the lifecycle edge is visible before its descriptor. */
  readonly descriptor?: ActiveSubagentDescriptor
}

export interface ActiveSubagentSnapshot {
  /** Always equal to `rows.length`. */
  readonly count: number
  /** One row per visible child, ordered by its first active run. */
  readonly rows: readonly ActiveSubagentRow[]
}

export type ActiveSubagentChange =
  | { readonly type: 'started'; readonly runId: string; readonly id: string }
  | { readonly type: 'ended'; readonly runId: string; readonly id: string }
  | { readonly type: 'dismissed'; readonly id: string }

export interface ActiveSubagentProjection {
  /** Latest atomic view consumed by the status bar, picker, and switch gate. */
  readonly current: ActiveSubagentSnapshot
  /** Record one lifecycle fact or disposable presentation dismissal. */
  record(change: ActiveSubagentChange): void
  /** Reconcile durable descriptors without letting an older read win. */
  refresh(): Promise<ActiveSubagentSnapshot>
  /** Idempotently cancel retries and discard in-flight read results. */
  dispose(): void
}

export interface ActiveSubagentProjectionOptions {
  readonly loadDescriptors: () => Promise<readonly SubagentDescendantListEntry[]>
  readonly onChange: (snapshot: ActiveSubagentSnapshot) => void
  readonly onBackgroundError: (error: unknown) => void
}

const RETRY_DELAYS_MS = [50, 100, 200, 400, 400] as const
const EMPTY_SNAPSHOT: ActiveSubagentSnapshot = Object.freeze({
  count: 0,
  rows: Object.freeze([]),
})

class DefaultActiveSubagentProjection implements ActiveSubagentProjection {
  private readonly activeRuns = new Map<string, string>()
  private readonly dismissedIds = new Set<string>()
  private descriptorsById = new Map<string, ActiveSubagentDescriptor>()
  private snapshot = EMPTY_SNAPSHOT
  private refreshRevision = 0
  private retryAttempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly options: ActiveSubagentProjectionOptions) {}

  get current(): ActiveSubagentSnapshot {
    return this.snapshot
  }

  record(change: ActiveSubagentChange): void {
    if (this.disposed) return

    if (change.type === 'started') {
      this.activeRuns.set(change.runId, change.id)
      this.dismissedIds.delete(change.id)
      this.descriptorsById.delete(change.id)
      this.retryAttempt = 0
    } else if (change.type === 'ended') {
      this.activeRuns.delete(change.runId)
      if (![...this.activeRuns.values()].includes(change.id)) {
        this.dismissedIds.delete(change.id)
        this.descriptorsById.delete(change.id)
      }
    } else {
      this.dismissedIds.add(change.id)
    }

    this.publish()
    if (this.snapshot.count === 0) this.clearRetry()
    void this.refresh().catch(error => { this.options.onBackgroundError(error) })
  }

  async refresh(): Promise<ActiveSubagentSnapshot> {
    if (this.disposed) return this.snapshot
    const revision = ++this.refreshRevision
    const entries = await this.options.loadDescriptors()
    if (this.disposed || revision !== this.refreshRevision) return this.snapshot

    this.descriptorsById = new Map(entries.flatMap(entry => entry.kind === 'child'
      ? [[String(entry.id), entry] as const]
      : []))
    this.publish()

    if (this.snapshot.rows.some(row => row.descriptor === undefined)) this.scheduleRetry()
    else this.clearRetry()
    return this.snapshot
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.refreshRevision += 1
    this.clearRetry()
  }

  private publish(): void {
    const visibleIds = [...new Set(
      [...this.activeRuns.values()].filter(id => !this.dismissedIds.has(id)),
    )]
    const rows = visibleIds.map((id): ActiveSubagentRow => {
      const descriptor = this.descriptorsById.get(id)
      return descriptor === undefined ? { id } : { id, descriptor }
    })
    this.snapshot = Object.freeze({
      count: rows.length,
      rows: Object.freeze(rows),
    })
    this.options.onChange(this.snapshot)
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined || this.retryAttempt >= RETRY_DELAYS_MS.length) return
    const delay = RETRY_DELAYS_MS[this.retryAttempt++]
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.refresh().catch(error => { this.options.onBackgroundError(error) })
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.retryAttempt = 0
  }
}

export function createActiveSubagentProjection(
  options: ActiveSubagentProjectionOptions,
): ActiveSubagentProjection {
  return new DefaultActiveSubagentProjection(options)
}
