/** Durable user-shell context; never impersonates an Agent tool call. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

export const SHELL_CONTEXT_PLUGIN = 'dsh-code/user-shell'
// Match the upstream v3 → v4 conversion of our released plugin attribution.
export const SHELL_CONTEXT_SOURCE = 'plugin:dsh-code/user-shell'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:dsh-code/user-shell': { kind: typeof SHELL_CONTEXT_SOURCE }
  }
}
export interface ShellContextResult {
  command: string
  output: string
  status: string
}

export function parseShellInput(text: string): { command: string; includeInContext: boolean } | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('!')) return undefined
  const includeInContext = !trimmed.startsWith('!!')
  return { command: trimmed.slice(includeInContext ? 1 : 2).trim(), includeInContext }
}

export function shellContextResult(command: string, result: ShellRunResult): ShellContextResult {
  const streams = [result.stdout, result.stderr].map(stream => {
    const suffix = stream.truncated
      ? `\n[output truncated${stream.spillPath === undefined ? '' : `; full output: ${stream.spillPath}`}]`
      : ''
    return stream.text + suffix
  })
  return {
    command,
    output: streams.filter(Boolean).join('\n'),
    status: result.timedOut ? 'timed out' : result.aborted ? 'aborted'
      : result.signal !== null ? `killed by ${result.signal}`
        : result.exitCode !== 0 && result.exitCode !== null ? `exit ${result.exitCode}` : '',
  }
}

export function shellContextMessage(result: ShellContextResult): UserMessage {
  return createUserMessage({
    source: { kind: SHELL_CONTEXT_SOURCE },
    // JSON safely preserves arbitrary command/output delimiters. These are
    // observations from a user-run command, not instructions or tool calls.
    content: [{ type: 'text', text: JSON.stringify({ kind: 'user-shell-result', ...result }) }],
  })
}

export function readShellContext(input: unknown): ShellContextResult | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const message = input as { source?: { kind?: string; plugin?: string }; content?: UserMessage['content'] }
  if (message.source?.kind !== SHELL_CONTEXT_SOURCE
    && !(message.source?.kind === 'plugin' && message.source.plugin === SHELL_CONTEXT_PLUGIN)) return undefined
  const block = Array.isArray(message.content) ? message.content[0] : undefined
  if (block?.type !== 'text' || typeof block.text !== 'string') return undefined
  try {
    const value = JSON.parse(block.text) as Partial<ShellContextResult> & { kind?: string }
    if (value?.kind !== 'user-shell-result' || typeof value.command !== 'string'
      || typeof value.output !== 'string' || typeof value.status !== 'string') return undefined
    return { command: value.command, output: value.output, status: value.status }
  } catch { return undefined }
}

/** Shell observations are durable at inbox insertion, before the loop admits them. */
export function shellMessagesInEvent(event: SessionEvent): readonly UserMessage[] {
  const messages = event.type === 'user/message' ? [event.data]
    : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
  return messages.filter(message => readShellContext(message) !== undefined)
}

/** Refuse an old shell-only surface that cannot accept a valid v4 system head. */
export function assertShellContextOrder(session: Session): void {
  const headSeq = session.surface.nodes[0]
  const head = headSeq === undefined ? undefined : session.eventAt(headSeq)
  if (head?.type === 'user/message' && readShellContext(head.data) !== undefined) {
    throw new Error('This legacy session saved shell context before its first system prompt. '
      + 'DSH v4 cannot continue that event order. The original logs are preserved; '
      + 'start a new session and retain the old logs for migration repair.')
  }
}

/** Preserve observations across cancellation until the loop commits them after its system head. */
export function installShellContextDelivery(agent: Agent): void {
  const pending = new Map<string, UserMessage>()
  const fold = (event: SessionEvent): void => {
    for (const message of shellMessagesInEvent(event)) {
      if (event.type === 'user/message') pending.delete(message.id)
      else pending.set(message.id, message)
    }
  }
  for (const event of agent.session.snapshotEvents()) fold(event)
  agent.ctx.on('session/event', (session, event) => { if (session === agent.session) fold(event) })
  agent.ctx.on('agent/pre-step', async ({ agent: source }, next) => {
    const decision = await next()
    if (source !== agent || decision.kind !== 'enter') return decision
    const supplied = new Set(decision.messages.map(message => message.id))
    const missing = [...pending.values()].filter(message => !supplied.has(message.id))
    return { ...decision, messages: [...missing, ...decision.messages] }
  })
}
