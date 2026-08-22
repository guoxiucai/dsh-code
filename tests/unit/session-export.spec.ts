import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CallId, createMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  defaultExportFilename,
  exportFormatForPath,
  renderSessionJsonl,
  renderSessionMarkdown,
  writeSessionExport,
} from '../../src/tui/session-export.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function sessionFixture(): Session {
  const id = SessionId('session/export:demo')
  const session = Session.create(id, undefined, { version: 0, id, cwd: '/workspace', createdAt: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId: CallId('call-1'), content: [{ type: 'text', text: 'done' }], isError: false }),
  }, { surfaceOp: 'append' })
  return session
}

describe('session export', () => {
  it('renders readable Markdown and lossless JSONL records', () => {
    const session = sessionFixture()
    const markdown = renderSessionMarkdown(session, 'Demo')
    expect(markdown).toContain('# Demo')
    expect(markdown).toContain('## User\n\nHello')
    expect(markdown).toContain('## Assistant\n\nHi there')
    expect(markdown).toContain('done')

    const records = renderSessionJsonl(session).trim().split('\n').map(line => JSON.parse(line) as { type: string })
    expect(records[0]?.type).toBe('session/header')
    expect(records).toHaveLength(session.events.length + 1)
  })

  it('chooses formats by extension, sanitizes defaults, and never overwrites', () => {
    expect(exportFormatForPath('a.JSONL')).toBe('jsonl')
    expect(exportFormatForPath('a.md')).toBe('markdown')
    expect(defaultExportFilename('session/a:b', 'markdown')).toBe('dsh-code-session-a-b.md')

    const cwd = mkdtempSync(join(tmpdir(), 'dsh-code-export-'))
    dirs.push(cwd)
    const session = sessionFixture()
    const path = writeSessionExport(cwd, 'exports/session.md', session, 'markdown', 'Demo')
    expect(readFileSync(path, 'utf8')).toContain('# Demo')
    expect(() => writeSessionExport(cwd, 'exports/session.md', session, 'markdown', 'Demo')).toThrow()

    const existing = join(cwd, 'keep.txt')
    writeFileSync(existing, 'keep')
    expect(readFileSync(existing, 'utf8')).toBe('keep')
  })
})
