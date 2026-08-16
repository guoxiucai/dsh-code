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
  | { kind: 'assistant'; text: string; reasoning?: string }
  | { kind: 'tool'; callId: string; name: string; arguments: string; status: 'running' | 'done' | 'error'; resultText?: string; errorCode?: string }
  | { kind: 'notice'; text: string }

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
}

/** A freshly seeded, empty view model for one session. */
export function emptyViewModel(sessionId: string): TuiViewModel {
  return { sessionId, transcript: [], phase: 'idle', todos: [], tokenUsage: undefined, permission: undefined, plan: false }
}
