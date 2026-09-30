import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import JsonlSessionPersistence from '../../deepseek-harness/packages/session/session-persistence-jsonl/lib/index.js'
import { projectKey, listProjectSessions } from '../../src/bootstrap/sessions.ts'
import { replayEvents } from '../../src/tui/reducer.ts'
import { renderSessionMarkdown } from '../../src/tui/session-export.ts'
import { shouldDiscardEmptyFreshSession } from '../../src/tui/plugin.ts'

it('migrates released shell context and tool results to v4 without changing the v3 log', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-code-v3-tui-'))
  const id = SessionId('legacy-shell-tool')
  const directory = join(home, 'sessions', projectKey(home), id)
  const path = join(directory, 'session.v3.jsonl')
  const shell = { command: 'ls', output: 'old.ts\n', status: '' }
  const rows = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'system/message', data: { turn: 1, step: 1, message: {
      id: 'system', role: 'system', source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
      content: [{ type: 'text', text: 'You are a coding agent.' }],
    } }, surfaceOp: 'append' },
    { type: 'user/message', data: {
      id: 'shell', role: 'user', source: { kind: 'plugin', plugin: 'dsh-code/user-shell' },
      content: [{ type: 'text', text: JSON.stringify({ kind: 'user-shell-result', ...shell }) }],
    }, surfaceOp: 'append' },
    { type: 'assistant/message', data: { turn: 1, step: 1, stream: [
      { type: 'tool-call-chunks', time0: 5, index: 0, id: 'call', name: 'bash', dt: [], args: ['{}'] },
      { type: 'chunk', time: 5, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
    ], message: {
      id: 'assistant', role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' },
      content: [{ type: 'tool-call', id: 'call', name: 'bash', arguments: '{}' }],
    } }, surfaceOp: 'append' },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call', name: 'bash', arguments: '{}' } },
    { type: 'tool/result', data: { turn: 1, step: 1, message: {
      id: 'result', role: 'user', source: { kind: 'tool', callId: 'call' },
      content: [{ type: 'tool-result', toolCallId: 'call', content: [{ type: 'text', text: 'legacy output' }], isError: false }],
    } }, surfaceOp: 'append' },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ].map((row, seq) => ({ ...row, seq, time: seq + 1 }))
  const original = [
    { type: 'session', version: 3, id, cwd: home, createdAt: 1, isSeeded: false, delegationDepth: 0 },
    ...rows,
  ].map(row => JSON.stringify(row) + '\n').join('')
  const ctx = new Context()
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(path, original)
    await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions'), compression: 'none' })
    for (const access of ['write', 'read'] as const) {
      const handle = await ctx.sessionPersistence.open(id, access)
      try {
        const restored = await handle.read()
        expect(handle.header.version).toBe(4)
        expect(restored.events[3]).toMatchObject({ data: { source: { kind: 'plugin:dsh-code/user-shell' } } })
        expect(replayEvents(id, restored.events)).toMatchObject({ phase: 'idle', transcript: [
          { kind: 'shell', ...shell },
          { kind: 'tool', status: 'done', resultText: 'legacy output' },
        ] })
        expect(shouldDiscardEmptyFreshSession(undefined, restored.events)).toBe(false)
        const session = Session.fromRestore(id, restored.events, handle.header, handle.inheritedEventCount, restored.eventState)
        expect(renderSessionMarkdown(session)).toContain('legacy output')
      } finally { await handle.close() }
    }
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await readFile(join(directory, 'session.v4.jsonl'), 'utf8')).toContain('"version":4')
    expect(listProjectSessions(home, home)[0]).toMatchObject({ id, title: '!ls' })
  } finally {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
}, 60_000)
