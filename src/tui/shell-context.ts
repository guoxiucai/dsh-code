/** Durable user-shell context; never impersonates an Agent tool call. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'

export const SHELL_CONTEXT_PLUGIN = 'dsh-code/user-shell'
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
    source: { kind: 'plugin', plugin: SHELL_CONTEXT_PLUGIN },
    // JSON safely preserves arbitrary command/output delimiters. These are
    // observations from a user-run command, not instructions or tool calls.
    content: [{ type: 'text', text: JSON.stringify({ kind: 'user-shell-result', ...result }) }],
  })
}

export function readShellContext(input: unknown): ShellContextResult | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const message = input as Partial<UserMessage>
  if (message.source?.kind !== 'plugin' || message.source.plugin !== SHELL_CONTEXT_PLUGIN) return undefined
  const block = Array.isArray(message.content) ? message.content[0] : undefined
  if (block?.type !== 'text' || typeof block.text !== 'string') return undefined
  try {
    const value = JSON.parse(block.text) as Partial<ShellContextResult> & { kind?: string }
    if (value?.kind !== 'user-shell-result' || typeof value.command !== 'string'
      || typeof value.output !== 'string' || typeof value.status !== 'string') return undefined
    return { command: value.command, output: value.output, status: value.status }
  } catch { return undefined }
}
