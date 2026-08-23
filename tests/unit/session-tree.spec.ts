import { describe, expect, it } from 'vitest'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { buildSessionTreeRows, sessionSwitchBlocker } from '../../src/tui/session-tree.ts'

function record(id: string, createdAt: number, options: Partial<SessionHeader> = {}): SessionRecord {
  return {
    header: { version: 0, id: SessionId(id), createdAt, cwd: '/project', ...options },
    live: id === 'current',
    persisted: true,
  }
}

describe('session tree projection', () => {
  it('shows the connected root, siblings and descendants with the active path first', () => {
    const rows = buildSessionTreeRows([
      record('unrelated', 0),
      record('root', 1),
      record('sibling', 2, { parentSession: SessionId('root') }),
      record('current', 3, { parentSession: SessionId('root') }),
      record('leaf', 4, { parentSession: SessionId('current') }),
      record('worker', 5, { parentSession: SessionId('current'), origin: 'subagent' }),
    ], 'current', new Map([['root', 'Original task'], ['current', 'Chosen branch']]))

    expect(rows.map(row => row.id)).toEqual(['root', 'current', 'leaf', 'sibling'])
    expect(rows.find(row => row.id === 'root')).toMatchObject({ title: 'Original task', activePath: true, depth: 0 })
    expect(rows.find(row => row.id === 'current')).toMatchObject({ title: 'Chosen branch', current: true, activePath: true, depth: 1 })
    expect(rows.find(row => row.id === 'worker')).toBeUndefined()
  })

  it('falls back to the current node when its parent is unavailable', () => {
    expect(buildSessionTreeRows([
      record('current', 2, { parentSession: SessionId('missing') }),
      record('child', 3, { parentSession: SessionId('current') }),
    ], 'current').map(row => row.id)).toEqual(['current', 'child'])
  })
})

describe('session switch gate', () => {
  it('blocks every activity that would be orphaned by process handoff', () => {
    expect(sessionSwitchBlocker({ agentRunning: true, queuedMessages: 0, liveJobs: 0, activeSubagents: 0 })).toContain('active turn')
    expect(sessionSwitchBlocker({ agentRunning: false, queuedMessages: 1, liveJobs: 0, activeSubagents: 0 })).toContain('queued messages')
    expect(sessionSwitchBlocker({ agentRunning: false, queuedMessages: 0, liveJobs: 0, activeSubagents: 1 })).toContain('subagents')
    expect(sessionSwitchBlocker({ agentRunning: false, queuedMessages: 0, liveJobs: 1, activeSubagents: 0 })).toContain('background jobs')
    expect(sessionSwitchBlocker({ agentRunning: false, queuedMessages: 0, liveJobs: 0, activeSubagents: 0 })).toBeUndefined()
  })
})
