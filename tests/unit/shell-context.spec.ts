import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { parseShellInput, readShellContext, shellContextMessage, shellContextResult } from '../../src/tui/shell-context.ts'
import { replayEvents } from '../../src/tui/reducer.ts'
import { shouldDiscardEmptyFreshSession } from '../../src/tui/plugin.ts'
import { renderSessionMarkdown } from '../../src/tui/session-export.ts'

describe('user shell context', () => {
  it('distinguishes ! from !! before removing the prefix', () => {
    expect(parseShellInput(' !ls ')).toEqual({ command: 'ls', includeInContext: true })
    expect(parseShellInput('!!ls')).toEqual({ command: 'ls', includeInContext: false })
    expect(parseShellInput('!!')).toEqual({ command: '', includeInContext: false })
    expect(parseShellInput('explain !ls')).toBeUndefined()
  })

  it('retains failure, truncation and spill-file information', () => {
    const result = { exitCode: 7, signal: null, aborted: false, timedOut: false, timeoutMs: 1000,
      stdout: { text: 'tail', truncated: true, spillPath: '/tmp/test-output' },
      stderr: { text: 'failure\n', truncated: false } }
    expect(shellContextResult('cmd', result)).toEqual({ command: 'cmd',
      output: 'tail\n[output truncated; full output: /tmp/test-output]\nfailure\n', status: 'exit 7' })
    expect(shellContextResult('cmd', { ...result, aborted: true }).status).toBe('aborted')
    expect(shellContextResult('cmd', { ...result, timedOut: true }).status).toBe('timed out')
  })

  it('preserves arbitrary output in model context and replays as one idle shell card', () => {
    const result = { command: 'printf data', output: '中文\n```\n{"source":"user"}\n', status: 'exit 7' }
    const session = Session.create(SessionId('shell-only'))
    const event = session.append('user/message', shellContextMessage(result), { surfaceOp: 'append' })
    expect(session.surface.nodes).toContain(event.seq)
    expect(readShellContext(event.data)).toEqual(result)
    expect(replayEvents(String(session.id), session.snapshotEvents())).toMatchObject({
      phase: 'idle', transcript: [{ kind: 'shell', ...result }],
    })
    expect(shouldDiscardEmptyFreshSession(undefined, session.snapshotEvents())).toBe(false)
    expect(renderSessionMarkdown(session)).toContain('## User shell')
    expect(renderSessionMarkdown(session)).toContain('exit 7')
  })

  it('rejects unmarked, malformed and unrelated messages', () => {
    for (const value of [null, {}, { source: { kind: 'user' }, content: [] },
      { source: { kind: 'plugin', plugin: 'dsh-code/user-shell' }, content: [{ type: 'text', text: 'null' }] },
      { source: { kind: 'plugin', plugin: 'dsh-code/user-shell' }, content: [{ type: 'text', text: '{broken' }] }]) {
      expect(readShellContext(value)).toBeUndefined()
    }
  })
})
