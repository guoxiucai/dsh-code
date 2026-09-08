import { describe, expect, it, vi } from 'vitest'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionSeq } from '@deepseek-ai/dsh-session'
import { persistFork, sessionForkPoints } from '../../src/tui/session-fork.ts'

describe('fork persistence handoff', () => {
  it.each([false, true])('releases the writer after flush (failure=%s)', async (fail) => {
    const order: string[] = []
    const child = Session.create(SessionId('child'))
    const handle = {
      append: vi.fn(async () => { order.push('append') }),
      flush: vi.fn(async () => { order.push('flush'); if (fail) throw new Error('disk failure') }),
      close: vi.fn(async () => { order.push('close') }),
    }
    const create = vi.fn(async () => handle)
    const operation = persistFork({ create } as unknown as SessionPersistence, child)
    if (fail) await expect(operation).rejects.toThrow('disk failure')
    else await operation
    expect(create).toHaveBeenCalledWith(child.header, { inheritedEventCount: child.inheritedEventCount })
    expect(handle.append).toHaveBeenCalledWith(child.snapshotEvents())
    expect(order).toEqual(['append', 'flush', 'close'])
  })
})

function appendHuman(session: Session, text: string): SessionSeq {
  return session.append('user/message', createUserMessage({
    content: text === '' ? [] : [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

describe('pi-style session fork points', () => {
  it('lists human prompts newest-first and cuts before their containing turns', () => {
    const session = Session.create(SessionId('source'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const firstSeq = appendHuman(session, 'first\n request')
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const secondTurnStart = session.append('turn/start', { turn: 2 }).seq
    session.append('step/start', { turn: 2, step: 1 })
    const secondSeq = appendHuman(session, '')
    session.append('step/end', { turn: 2, step: 1 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    expect(sessionForkPoints(session.snapshotEvents())).toEqual([
      { userSeq: secondSeq, cut: secondTurnStart, time: expect.any(Number), text: '(non-text prompt)' },
      { userSeq: firstSeq, cut: 0, time: expect.any(Number), text: 'first request' },
    ])
  })

  it('maps multiple prompts in one DSH turn to the same stable cut', () => {
    const session = Session.create(SessionId('source'))
    const cut = session.append('turn/start', { turn: 1 }).seq
    session.append('step/start', { turn: 1, step: 1 })
    appendHuman(session, 'initial')
    appendHuman(session, 'steered follow-up')

    expect(sessionForkPoints(session.snapshotEvents()).map(point => point.cut)).toEqual([cut, cut])
  })

  it('cuts before the selected request entered the durable inbox', () => {
    const session = Session.create(SessionId('source'))
    const message = createUserMessage({
      content: [{ type: 'text', text: 'queued request' }],
      source: { kind: 'user' },
    })
    const cut = session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [message],
    }).seq
    session.append('turn/start', { turn: 1 })
    session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [],
    })
    session.append('step/start', { turn: 1, step: 1 })
    const userSeq = session.append('user/message', message, { surfaceOp: 'append' }).seq

    expect(sessionForkPoints(session.snapshotEvents())).toEqual([
      { userSeq, cut, time: expect.any(Number), text: 'queued request' },
    ])
  })
})
