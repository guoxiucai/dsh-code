/**
 * Pure terminal-UI view model. This is the only state the TUI renders from; it
 * is derived exclusively from structured Session events (never guessed from
 * text) and is the shared shape between live rendering and replay.
 * @module dsh-code/tui/view-model
 */

/** Interaction phase the UI is currently in. */
export type Phase = 'idle' | 'running' | 'waiting-approval' | 'waiting-user' | 'stopping'

/** One rendered transcript row. */
export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; reasoning?: string; reasoningDurationMs?: number }
  | { kind: 'tool'; callId: string; name: string; arguments: string; status: 'running' | 'done' | 'error'; resultText?: string; errorCode?: string; startedAt?: number; elapsedMs?: number; diffs?: ToolDiff[] }
  | { kind: 'notice'; text: string }

/** A file diff carried by a write/edit tool result (from the tool's `meta`). */
export interface ToolDiff {
  path: string
  oldText: string | null
  newText: string
}

/** One todo entry (mirrors the upstream `todo/write` whole-list snapshot). */
export interface TodoSummary {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Cumulative token accounting from the latest assistant message. */
export interface TokenUsageSummary {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** The terminal-UI view model, reduced from Session events. */
export interface TuiViewModel {
  sessionId: string
  transcript: TranscriptItem[]
  phase: Phase
  todos: TodoSummary[]
  tokenUsage: TokenUsageSummary | undefined
  /** The current permission preset name (last `permission/preset`), if any. */
  permission: string | undefined
  /** Whether plan mode is active (last `plan/mode`). */
  plan: boolean
  /** An in-progress provider retry (last `llm/retry`), if any. */
  retryStatus: RetryStatus | undefined
  /** Whether a standalone context compaction is in progress. */
  compacting: boolean
}

/** A provider-routed model-request retry, for the countdown indicator. */
export interface RetryStatus {
  /** 1-based retry attempt number. */
  retry: number
  /** Maximum retries (absent for an `always` policy). */
  maxRetries: number | undefined
  /** The scheduled wait, in milliseconds. */
  delayMs: number
  /** Wall-clock epoch ms the wait was scheduled (for the countdown). */
  scheduledAt: number
}

/** A freshly seeded, empty view model for one session. */
export function emptyViewModel(sessionId: string): TuiViewModel {
  return { sessionId, transcript: [], phase: 'idle', todos: [], tokenUsage: undefined, permission: undefined, plan: false, retryStatus: undefined, compacting: false }
}
