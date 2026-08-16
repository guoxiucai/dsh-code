/**
 * Pure Session-event reducer. Turns the append-only `session/event` feed into a
 * {@link TuiViewModel} transcript. Pure and deterministic: replaying a persisted
 * log through this reducer yields the same normalized view model as live
 * application. Deduplicates by seq, fails fast on a seq gap (out-of-order or a
 * missing event would silently reconstruct a wrong transcript), skips unknown
 * `ignorable` events, and refuses unknown required events.
 * @module dsh-code/tui/reducer
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Declaration-merges the `approval/asked` / `approval/decided` event types into
// the Session event union.
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { TodoSummary, TranscriptItem, TuiViewModel } from './view-model.ts'

/** Thrown when an event arrives with a non-contiguous seq (reorder or gap). */
export class EventSequenceError extends Error {
  constructor(expected: number, received: number) {
    super(`session event sequence gap: expected seq ${expected}, got ${received}`)
    this.name = 'EventSequenceError'
  }
}

/** Thrown when a required event type is unrecognized (a newer harness wrote the log). */
export class UnknownRequiredEventError extends Error {
  constructor(type: string) {
    super(`cannot render session: unrecognized required event type ${JSON.stringify(type)}; upgrade dsh-code`)
    this.name = 'UnknownRequiredEventError'
  }
}

/**
 * The session event vocabulary the current baseline understands but this
 * reducer does not render (boundaries, audit records, hooks, compaction,
 * policy switches). These are skipped gracefully — they are known, so a skip
 * is safe — while a type OUTSIDE this set follows the ignorable/required
 * policy. Synced manually with `@deepseek-ai/dsh-session` KNOWN_SESSION_EVENT_TYPES
 * at the pinned baseline (see UPSTREAM_BASELINE.md).
 */
const KNOWN_UNRENDERED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/policy',
  'command/done', 'command/run', 'compaction/end', 'compaction/prune',
  'compaction/start', 'compaction/summary', 'feedback/record', 'goal/change',
  'hook/invoked', 'hook/result', 'llm/retry', 'llm/retry-started',
  'permission/preset', 'plan/mode', 'request/context', 'request/header',
  'sandbox/mode', 'schedule/change', 'session/title', 'session/title-llm-request',
  'subagent/descriptor', 'tool-workflow/agent-end', 'tool-workflow/agent-start',
  'tool-workflow/run-end', 'tool-workflow/run-start', 'tool/code-dispatch',
  'tool/code-dispatch-start', 'web/deepseek-search-llm-request',
])

/** In-flight assistant stream (not yet committed to the transcript). */
interface DraftAssistant {
  text: string
  reasoning: string
}

/** Reducer state: the view model plus the transient streaming draft and seq cursor. */
export interface ReducerState extends TuiViewModel {
  lastSeq: number
  draftAssistant: DraftAssistant | undefined
}

/** Create a reducer state seeded from a fresh (or empty) view model. */
export function createReducerState(sessionId: string): ReducerState {
  return { sessionId, transcript: [], phase: 'idle', todos: [], tokenUsage: undefined, lastSeq: -1, draftAssistant: undefined }
}

/** Max characters retained in a collapsed tool-result preview. */
const MAX_TOOL_RESULT_PREVIEW = 2000

/** Join the visible text of a content block list. */
export function textOf(blocks: readonly ContentBlock[]): string {
  let out = ''
  for (const block of blocks) if (block.type === 'text') out += block.text
  return out
}

/** Join the reasoning text of a content block list. */
export function reasoningOf(blocks: readonly ContentBlock[]): string {
  let out = ''
  for (const block of blocks) if (block.type === 'reasoning') out += block.text
  return out
}

/** Collapse a tool result into a bounded single-line preview. */
function previewResult(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_TOOL_RESULT_PREVIEW) return normalized
  return `${normalized.slice(0, MAX_TOOL_RESULT_PREVIEW)}… (truncated)`
}

/** Commit any in-flight assistant draft into the transcript. */
function commitDraft(state: ReducerState): TranscriptItem[] {
  const draft = state.draftAssistant
  if (draft === undefined) return state.transcript
  if (draft.text === '' && draft.reasoning === '') return state.transcript
  return [...state.transcript, {
    kind: 'assistant',
    text: draft.text,
    ...(draft.reasoning !== '' ? { reasoning: draft.reasoning } : {}),
  }]
}

/** Human-readable close reason for a `turn/end` notice (empty for `completed`). */
function turnEndNotice(reason: { kind: string } & Record<string, unknown>): string | undefined {
  switch (reason.kind) {
    case 'completed': return undefined
    case 'aborted': return 'turn cancelled'
    case 'error': {
      const error = reason.error as { message?: string; code?: string } | undefined
      return `turn failed: ${error?.code ?? 'ERROR'}${error?.message !== undefined ? ` — ${error.message}` : ''}`
    }
    case 'max-tokens': return 'turn stopped: output token limit reached'
    case 'interrupted': return 'turn interrupted (session was closed by a crash recovery)'
    case 'blocked': return 'turn blocked'
    default: return `turn ended: ${reason.kind}`
  }
}

/**
 * Apply one Session event to the reducer state. Pure except for the
 * documented throws (sequence gap, unknown required event).
 */
export function reduceSessionEvent(state: ReducerState, event: SessionEvent): ReducerState {
  if (event.seq <= state.lastSeq) return state // EVT-005: dedup by seq
  if (event.seq !== state.lastSeq + 1) {
    // EVT-006: out-of-order or missing — fail fast, never reorder into a wrong history
    throw new EventSequenceError(state.lastSeq + 1, event.seq)
  }
  const base = { ...state, lastSeq: event.seq }

  switch (event.type) {
    case 'turn/start':
      return { ...base, phase: 'running', transcript: commitDraft(state) }
    case 'turn/end': {
      const transcript = commitDraft(state)
      const notice = turnEndNotice(event.data.reason)
      return {
        ...base,
        phase: 'idle',
        transcript: notice === undefined ? transcript : [...transcript, { kind: 'notice', text: notice }],
      }
    }
    case 'step/start':
    case 'step/end':
      return { ...base, phase: 'running' }

    case 'user/message': {
      const source = event.data.source
      // A human prompt is a user item; an injected notice is a notice; other
      // injected context (runtime snapshot, catalog, instructions) is not a
      // human message and is collapsed from the transcript.
      if (source.kind === 'user') {
        return { ...base, phase: 'running', transcript: [...commitDraft(state), { kind: 'user', text: textOf(event.data.content) }] }
      }
      if (source.kind === 'plugin' && source.form === 'notice') {
        return { ...base, phase: 'running', transcript: [...commitDraft(state), { kind: 'notice', text: source.summary }] }
      }
      return { ...base, phase: 'running' }
    }

    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        const draft = state.draftAssistant ?? { text: '', reasoning: '' }
        return { ...base, phase: 'running', draftAssistant: { ...draft, text: draft.text + chunk.text } }
      }
      if (chunk.type === 'reasoning-delta') {
        const draft = state.draftAssistant ?? { text: '', reasoning: '' }
        return { ...base, phase: 'running', draftAssistant: { ...draft, reasoning: draft.reasoning + chunk.text } }
      }
      return { ...base, phase: 'running' }
    }

    case 'assistant/message': {
      const message = event.data.message
      const draft = state.draftAssistant
      // The assembled message is authoritative; the streamed draft was only a
      // live preview and must not be committed separately.
      const text = textOf(message.content) !== '' ? textOf(message.content) : (draft?.text ?? '')
      const reasoning = reasoningOf(message.content) !== '' ? reasoningOf(message.content) : (draft?.reasoning ?? '')
      const transcript = state.transcript
      let next = transcript
      if (text !== '' || reasoning !== '') {
        next = [...transcript, { kind: 'assistant', text, ...(reasoning !== '' ? { reasoning } : {}) }]
      }
      const usage = event.data.usage
      const tokenUsage = usage === undefined ? state.tokenUsage : {
        inputTokens: (state.tokenUsage?.inputTokens ?? 0) + usage.inputTokens,
        outputTokens: (state.tokenUsage?.outputTokens ?? 0) + usage.outputTokens,
        cacheReadTokens: (state.tokenUsage?.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
        cacheWriteTokens: (state.tokenUsage?.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
        reasoningTokens: (state.tokenUsage?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
      }
      return { ...base, phase: 'running', transcript: next, draftAssistant: undefined, tokenUsage }
    }

    case 'tool/call':
      return {
        ...base,
        phase: 'running',
        transcript: [...commitDraft(state), {
          kind: 'tool',
          callId: String(event.data.callId),
          name: event.data.name,
          arguments: event.data.arguments,
          status: 'running',
        }],
      }

    case 'tool/result': {
      const block = event.data.message.content[0]
      const callId = block?.toolCallId !== undefined ? String(block.toolCallId) : String(event.data.message.source.callId)
      const resultText = previewResult(textOf(block?.content ?? []))
      const failed = event.data.error !== undefined || block?.isError === true
      const transcript = state.transcript.map(item => item.kind === 'tool' && item.callId === callId
        ? {
          ...item,
          status: failed ? 'error' : 'done',
          ...(resultText !== '' ? { resultText } : {}),
          ...(event.data.error !== undefined ? { errorCode: event.data.error.code } : {}),
        } as const
        : item)
      return { ...base, phase: 'running', transcript }
    }

    case 'todo/write':
      return { ...base, todos: event.data.todos.map(({ content, status }): TodoSummary => ({ content, status })) }

    case 'session/end-seed':
      return base

    case 'approval/asked':
      return { ...base, phase: 'waiting-approval' }

    case 'approval/decided':
      return { ...base, phase: 'running' }

    default: {
      // Known-but-unrendered events are skipped safely; a type OUTSIDE the
      // current vocabulary follows the ignorable/required policy.
      const unknown = event as unknown as { type: string; ignorable?: true }
      if (KNOWN_UNRENDERED_EVENT_TYPES.has(unknown.type)) return base
      if (unknown.ignorable === true) return base
      throw new UnknownRequiredEventError(unknown.type)
    }
  }
}

/** Replay a persisted event list into a fresh view model (used by resume). */
export function replayEvents(sessionId: string, events: readonly SessionEvent[]): ReducerState {
  let state = createReducerState(sessionId)
  for (const event of events) state = reduceSessionEvent(state, event)
  return state
}
