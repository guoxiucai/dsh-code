/** Pure helpers for pi-style history selection over DSH's turn-bounded log. */

import { SessionLogOffset, type SessionEvent, type SessionSeq } from '@deepseek-ai/dsh-session'

/** One human prompt and the exclusive event cut immediately before its turn. */
export interface SessionForkPoint {
  userSeq: SessionSeq
  cut: SessionLogOffset
  time: number
  text: string
}

interface PendingForkMessage {
  id: string
  insertedAt: SessionLogOffset
}

/** Flatten only visible text blocks and normalize them for a one-line selector. */
function promptLabel(event: SessionEvent<'user/message'>): string {
  const text = event.data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
  return text === '' ? '(non-text prompt)' : text
}

/**
 * List human prompts newest-first. DSH cannot cut inside an open turn, so every
 * point maps to the start of the turn containing that prompt. Multiple human
 * messages admitted in one turn intentionally share the same cut.
 */
export function sessionForkPoints(events: readonly SessionEvent[]): SessionForkPoint[] {
  const points: SessionForkPoint[] = []
  let turnStart: SessionLogOffset | undefined
  let turnCut: SessionLogOffset | undefined
  let turnPointStart = 0
  const inbox: Record<'next-turn' | 'next-step', PendingForkMessage[]> = {
    'next-turn': [],
    'next-step': [],
  }
  const claimed = new Map<string, PendingForkMessage>()
  for (const event of events) {
    if (event.type === 'agent/inbox/spliced') {
      const insertedAt = SessionLogOffset(event.seq)
      const removed = inbox[event.data.target].splice(
        event.data.start,
        event.data.removedCount ?? 0,
        ...event.data.inserted.map(message => ({ id: message.id, insertedAt })),
      )
      for (const message of event.data.inserted) claimed.delete(message.id)
      if (event.data.outcome !== 'canceled') {
        for (const message of removed) claimed.set(message.id, message)
      }
      continue
    }
    if (event.type === 'turn/start') {
      turnStart = SessionLogOffset(event.seq)
      turnCut = turnStart
      turnPointStart = points.length
      continue
    }
    if (event.type === 'turn/end') {
      turnStart = undefined
      turnCut = undefined
      continue
    }
    if (event.type !== 'user/message' || event.data.source.kind !== 'user' || turnStart === undefined) continue
    const admitted = claimed.get(event.data.id)
    claimed.delete(event.data.id)
    if (admitted !== undefined && turnCut !== undefined && admitted.insertedAt < turnCut) {
      turnCut = admitted.insertedAt
      for (let index = turnPointStart; index < points.length; index += 1) {
        const point = points[index]
        if (point !== undefined) point.cut = turnCut
      }
    }
    points.push({ userSeq: event.seq, cut: turnCut ?? turnStart, time: event.time, text: promptLabel(event) })
  }
  return points.reverse()
}
