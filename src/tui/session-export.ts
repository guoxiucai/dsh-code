/** Terminal-owned Session export over the public DSH Session log. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

export type SessionExportFormat = 'markdown' | 'jsonl'

function textBlocks(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .filter((block): block is { type: 'text'; text: string } => (
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ))
    .map(block => block.text)
    .join('\n')
}

function fence(value: string, language = ''): string {
  const longest = Math.max(3, ...[...value.matchAll(/`+/g)].map(match => match[0].length + 1))
  const marker = '`'.repeat(longest)
  return `${marker}${language}\n${value}\n${marker}`
}

function eventMarkdown(event: SessionEvent): string | undefined {
  const data = event.data as unknown as Record<string, unknown>
  const message = typeof data.message === 'object' && data.message !== null
    ? data.message as Record<string, unknown>
    : undefined
  if (event.type === 'user/message') {
    const text = textBlocks(data.content)
    return text === '' ? undefined : `## User\n\n${text}`
  }
  if (event.type === 'assistant/message') {
    const text = textBlocks(message?.content)
    return text === '' ? undefined : `## Assistant\n\n${text}`
  }
  if (event.type === 'tool/call') {
    const name = typeof data.name === 'string' ? data.name : 'tool'
    const args = typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}, null, 2)
    return `### Tool call: ${name}\n\n${fence(args, 'json')}`
  }
  if (event.type === 'tool/result') {
    const content = Array.isArray(message?.content)
      ? message.content.flatMap((block) => {
        if (typeof block !== 'object' || block === null) return []
        const record = block as Record<string, unknown>
        if (record.type === 'text' && typeof record.text === 'string') return [record.text]
        if (record.type === 'tool-result' && Array.isArray(record.content)) return [textBlocks(record.content)]
        return []
      }).filter(Boolean).join('\n')
      : ''
    const text = content
    const body = text === '' ? JSON.stringify(data, null, 2) : text
    return `### Tool result\n\n${fence(body)}`
  }
  return undefined
}

/** Render the human-readable subset of a Session without guessing Agent state. */
export function renderSessionMarkdown(session: Pick<Session, 'header' | 'events'>, title?: string): string {
  const header = session.header
  const sections = session.events.map(eventMarkdown).filter((value): value is string => value !== undefined)
  return [
    `# ${title?.trim() || `dsh-code session ${String(header.id)}`}`,
    '',
    `- Session: \`${String(header.id)}\``,
    `- Working directory: \`${header.cwd ?? ''}\``,
    `- Created: ${new Date(header.createdAt).toISOString()}`,
    '',
    ...sections.flatMap(section => [section, '']),
  ].join('\n').trimEnd() + '\n'
}

/** Render one header record followed by the exact public Session events. */
export function renderSessionJsonl(session: Pick<Session, 'header' | 'events'>): string {
  return [
    JSON.stringify({ type: 'session/header', data: session.header }),
    ...session.events.map(event => JSON.stringify(event)),
  ].join('\n') + '\n'
}

export function exportFormatForPath(path: string): SessionExportFormat {
  return extname(path).toLowerCase() === '.jsonl' ? 'jsonl' : 'markdown'
}

export function defaultExportFilename(sessionId: string, format: SessionExportFormat): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]+/g, '-')
  return `dsh-code-${safe}.${format === 'jsonl' ? 'jsonl' : 'md'}`
}

/**
 * Write a private local export. Existing files are never overwritten; callers
 * can choose another path explicitly instead of losing data silently.
 */
export function writeSessionExport(
  cwd: string,
  path: string,
  session: Pick<Session, 'header' | 'events'>,
  format: SessionExportFormat,
  title?: string,
): string {
  const absolute = resolve(cwd, path)
  mkdirSync(dirname(absolute), { recursive: true })
  const content = format === 'jsonl' ? renderSessionJsonl(session) : renderSessionMarkdown(session, title)
  writeFileSync(absolute, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return absolute
}
