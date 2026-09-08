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
