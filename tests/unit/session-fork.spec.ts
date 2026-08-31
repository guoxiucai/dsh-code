import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { sessionForkPoints } from '../../src/tui/session-fork.ts'

function appendHuman(session: Session, text: string): number {
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

    expect(sessionForkPoints(session.events)).toEqual([
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

    expect(sessionForkPoints(session.events).map(point => point.cut)).toEqual([cut, cut])
  })
})
