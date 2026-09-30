import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { assertShellContextOrder, installShellContextDelivery, parseShellInput, readShellContext, shellContextMessage, shellContextResult } from '../../src/tui/shell-context.ts'
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

  it('renders and exports inbox shell observations once, before or after model admission', () => {
    const session = Session.create(SessionId('pending-shell'))
    const message = shellContextMessage({ command: 'ls', output: 'one.ts', status: '' })
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
    expect(() => assertShellContextOrder(session)).not.toThrow()
    expect(session.surface.nodes).toEqual([])
    expect(shouldDiscardEmptyFreshSession(undefined, session.snapshotEvents())).toBe(false)
    expect(replayEvents(session.id, session.snapshotEvents()).transcript).toHaveLength(1)
    expect(renderSessionMarkdown(session)).toContain('one.ts')
    session.append('user/message', message, { surfaceOp: 'append' })
    expect(replayEvents(session.id, session.snapshotEvents()).transcript).toHaveLength(1)
    expect(renderSessionMarkdown(session).match(/## User shell/g)).toHaveLength(1)
  })

  it('refuses to continue legacy shell-first surfaces without rewriting the log', () => {
    const session = Session.create(SessionId('legacy-shell-first'))
    session.append('user/message', shellContextMessage({ command: 'ls', output: 'saved', status: '' }), { surfaceOp: 'append' })
    const before = session.snapshotEvents()
    expect(() => assertShellContextOrder(session)).toThrow('original logs are preserved')
    expect(session.snapshotEvents()).toEqual(before)
  })

  it('recovers canceled pending shell context without resending already admitted observations', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('canceled-shell'))
    const shell = shellContextMessage({ command: 'ls', output: 'saved', status: '' })
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [shell] })
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' })
    const agent = { ctx, session } as Agent
    installShellContextDelivery(agent)
    const human = createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } })
    const enter = (messages: typeof human[]) => ctx.waterfall('agent/pre-step', {
      agent, messages, turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages }))
    try {
      expect(await enter([human])).toMatchObject({ messages: [shell, human] })
      expect(await enter([shell, human])).toMatchObject({ messages: [shell, human] })
      const event = session.append('user/message', shell, { surfaceOp: 'append' })
      ctx.emit('session/event', session, event)
      expect(await enter([human])).toMatchObject({ messages: [human] })
    } finally { await ctx.fiber.dispose() }
  })
})
