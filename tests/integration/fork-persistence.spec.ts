import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import JsonlSessionPersistence from '../../deepseek-harness/packages/session/session-persistence-jsonl/lib/index.js'
import { persistFork } from '../../src/tui/session-fork.ts'
import { listProjectSessions } from '../../src/bootstrap/sessions.ts'
import { shellContextMessage } from '../../src/tui/shell-context.ts'
import { replayEvents } from '../../src/tui/reducer.ts'

it('persists an unattached fork, lists its lineage, and permits a fresh writer', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-code-fork-storage-'))
  const ctx = new Context()
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions'), compression: 'zstd' })
  try {
    const parent = Session.create(SessionId('parent'))
    parent.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'fork history' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const id = SessionId('child')
    const child = Session.create(id, parent.snapshotEvents(), {
      ...parent.header, id, cwd: home, parentSession: parent.id, isSeeded: true,
    }, SessionLogOffset(parent.seq))
    await persistFork(ctx.sessionPersistence, child)
    expect(listProjectSessions(home, home)[0]).toMatchObject({ id, title: 'fork history', parentSession: parent.id })
    const handle = await ctx.sessionPersistence.open(id, 'write')
    try {
      const restored = await handle.read()
      expect(restored.events).toEqual(child.snapshotEvents())
      expect(restored.eventState).toBe('shared-frozen')
      expect(handle.inheritedEventCount).toBe(parent.seq)
    } finally {
      await handle.close()
    }
  } finally {
    await fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

it('persists shell-only context, lists it as nonempty, and restores the shell card and model surface', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-code-shell-storage-'))
  const ctx = new Context()
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions'), compression: 'zstd' })
  try {
    const id = SessionId('shell-only')
    const session = Session.create(id, [], { ...Session.create(id).header, cwd: home })
    const result = { command: 'ls', output: 'one.ts\ntwo.ts\n', status: '' }
    session.append('user/message', shellContextMessage(result), { surfaceOp: 'append' })
    await persistFork(ctx.sessionPersistence, session)
    expect(listProjectSessions(home, home)[0]).toMatchObject({ id: session.id, title: '!ls' })
    const handle = await ctx.sessionPersistence.open(session.id, 'read')
    try {
      const read = await handle.read()
      const restored = Session.fromRestore(id, read.events, session.header, handle.inheritedEventCount, read.eventState)
      expect(restored.surface.nodes).toEqual(session.surface.nodes)
      expect(replayEvents(String(session.id), read.events)).toMatchObject({
        phase: 'idle', transcript: [{ kind: 'shell', ...result }],
      })
    } finally { await handle.close() }
  } finally {
    await fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
