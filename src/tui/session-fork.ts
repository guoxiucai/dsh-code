/** Pure helpers for pi-style history selection over DSH's turn-bounded log. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One human prompt and the exclusive event cut immediately before its turn. */
export interface SessionForkPoint {
  userSeq: number
  cut: number
  time: number
  text: string
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
  let turnStart: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      turnStart = event.seq
      continue
    }
    if (event.type === 'turn/end') {
      turnStart = undefined
      continue
    }
    if (event.type !== 'user/message' || event.data.source.kind !== 'user' || turnStart === undefined) continue
    points.push({ userSeq: event.seq, cut: turnStart, time: event.time, text: promptLabel(event) })
  }
  return points.reverse()
}
