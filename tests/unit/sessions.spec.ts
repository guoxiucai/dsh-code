import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'
import {
  deleteProjectSession,
  deleteSession,
  listAllSessions,
  listProjectSessions,
  newlyCreatedEmptySessions,
  projectKey,
  sessionLineage,
  type ProjectSession,
} from '../../src/bootstrap/sessions.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** Write a session log with a header and an optional first human user message. */
function writeSessionLog(
  sessionDir: string,
  id: string,
  createdAt: number,
  title?: string,
  cwd?: string,
  origin?: 'subagent',
  parentSession?: string,
): void {
  mkdirSync(sessionDir, { recursive: true })
  const header = JSON.stringify({
    type: 'session', id, createdAt,
    ...(cwd === undefined ? {} : { cwd }),
    ...(origin === undefined ? {} : { origin }),
    ...(parentSession === undefined ? {} : { parentSession }),
  })
  if (title === undefined) {
    writeFileSync(join(sessionDir, 'session.jsonl'), header + '\n')
    return
  }
  const userMessage = JSON.stringify({
    type: 'user/message',
    seq: 1,
    time: createdAt + 1,
    data: { content: [{ type: 'text', text: title }], source: { kind: 'user' } },
  })
  writeFileSync(join(sessionDir, 'session.jsonl'), `${header}\n${userMessage}\n`)
}

/** Write a checksummed, concatenated zstd frame log (header frame + event frame). */
function writeZstdSessionLog(sessionDir: string, id: string, createdAt: number, title: string): void {
  mkdirSync(sessionDir, { recursive: true })
  const header = JSON.stringify({ type: 'session', id, createdAt }) + '\n'
  const userMessage = JSON.stringify({
    type: 'user/message',
    seq: 1,
    time: createdAt + 1,
    data: { content: [{ type: 'text', text: title }], source: { kind: 'user' } },
  }) + '\n'
  const checksummed = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
  const frames = Buffer.concat([
    zstdCompressSync(header, checksummed),
    zstdCompressSync(userMessage, checksummed),
  ])
  writeFileSync(join(sessionDir, 'session.jsonl.zstd'), frames)
}

describe('projectKey', () => {
  it('maps separators to dashes with the upstream --…-- envelope', () => {
    expect(projectKey('/a/b/c')).toBe('--a-b-c--')
    expect(projectKey('/private/tmp/dsh-code-smoke/proj')).toBe('--private-tmp-dsh-code-smoke-proj--')
  })

  it('escapes unsafe characters', () => {
    expect(projectKey('/a b')).toBe('--a~0020b--')
  })
})

describe('listProjectSessions', () => {
  it('returns an empty list when no project directory exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    expect(listProjectSessions(home, '/no/such/project')).toEqual([])
  })

  it('lists the session id, first user message, timestamp, and directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const sessionDir = join(home, 'sessions', projectKey('/proj'), 'session-abc')
    writeSessionLog(sessionDir, 'session-abc', 1700000000000, '新增一个')
    const sessions = listProjectSessions(home, '/proj')
    expect(sessions).toEqual([
      { id: 'session-abc', title: '新增一个', createdAt: 1700000000000, dir: sessionDir },
    ])
  })

  it('reads the project cwd from the session header', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const sessionDir = join(home, 'sessions', projectKey('/proj'), 'session-cwd')
    writeSessionLog(sessionDir, 'session-cwd', 1700000000000, '了解此项目', '/Users/qingwei/dev/Harmony')
    const sessions = listProjectSessions(home, '/proj')
    expect(sessions[0]?.cwd).toBe('/Users/qingwei/dev/Harmony')
  })

  it('reads ordinary fork lineage from the session header', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const sessionDir = join(home, 'sessions', projectKey('/proj'), 'session-child')
    writeSessionLog(sessionDir, 'session-child', 1700000000000, 'child', '/proj', undefined, 'session-parent')
    expect(listProjectSessions(home, '/proj')[0]?.parentSession).toBe('session-parent')
  })

  it('reads the title from concatenated zstd frames (header + event frames)', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const sessionDir = join(home, 'sessions', projectKey('/proj'), 'session-z')
    writeZstdSessionLog(sessionDir, 'session-z', 1700000000000, '扫描代码，了解此项目')
    const sessions = listProjectSessions(home, '/proj')
    expect(sessions).toEqual([
      { id: 'session-z', title: '扫描代码，了解此项目', createdAt: 1700000000000, dir: sessionDir },
    ])
  })

  it('sorts newest first and falls back to an empty title without a user message', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const base = join(home, 'sessions', projectKey('/proj'))
    writeSessionLog(join(base, 'older'), 'older', 1000)
    writeSessionLog(join(base, 'newer'), 'newer', 2000, 'hello')
    const sessions = listProjectSessions(home, '/proj')
    expect(sessions.map(session => session.id)).toEqual(['newer', 'older'])
    expect(sessions[1]?.title).toBe('')
  })

  it('excludes subagent-owned sessions from project resume and continue flows', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const base = join(home, 'sessions', projectKey('/proj'))
    writeSessionLog(join(base, 'main'), 'main', 1000, 'main session')
    writeSessionLog(join(base, 'child'), 'child', 2000, 'delegated task', '/proj', 'subagent')
    expect(listProjectSessions(home, '/proj').map(session => session.id)).toEqual(['main'])
  })
})

describe('listAllSessions', () => {
  it('lists sessions across every project directory, newest first', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    writeSessionLog(join(home, 'sessions', projectKey('/a'), 'a-session'), 'a-session', 1000, 'alpha')
    writeSessionLog(join(home, 'sessions', projectKey('/b'), 'b-session'), 'b-session', 3000, 'beta')
    const sessions = listAllSessions(home)
    expect(sessions.map(session => session.id)).toEqual(['b-session', 'a-session'])
  })

  it('excludes subagent-owned sessions from the all-folder resume scope', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    writeSessionLog(join(home, 'sessions', projectKey('/a'), 'main'), 'main', 1000, 'main')
    writeSessionLog(join(home, 'sessions', projectKey('/b'), 'child'), 'child', 2000, 'child', '/b', 'subagent')
    expect(listAllSessions(home).map(session => session.id)).toEqual(['main'])
  })
})

describe('deleteSession', () => {
  it('removes the session directory and reports success', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const sessionDir = join(home, 'sessions', projectKey('/proj'), 'session-abc')
    writeSessionLog(sessionDir, 'session-abc', 1700000000000, 'to delete')
    expect(deleteSession(sessionDir)).toBe(true)
    expect(existsSync(sessionDir)).toBe(false)
  })

  it('resolves a project Session id before deleting its directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const sessionDir = join(home, 'sessions', projectKey('/proj'), 'session-empty')
    writeSessionLog(sessionDir, 'session-empty', 1700000000000)
    expect(deleteProjectSession(home, '/proj', 'session-empty')).toBe(true)
    expect(existsSync(sessionDir)).toBe(false)
  })
})

describe('newlyCreatedEmptySessions', () => {
  const session = (id: string, title: string): ProjectSession => ({
    id,
    title,
    createdAt: 1,
    dir: `/sessions/${id}`,
    cwd: '/proj',
  })

  it('selects only empty sessions introduced during the surface lease', () => {
    const before = new Set(['existing-empty', 'existing-message'])
    const sessions = [
      session('existing-empty', ''),
      session('existing-message', 'before'),
      session('new-empty', ''),
      session('new-message', 'from Web'),
    ]
    expect(newlyCreatedEmptySessions(before, sessions).map(entry => entry.id)).toEqual(['new-empty'])
  })
})

describe('sessionLineage', () => {
  const session = (id: string, createdAt: number, parentSession?: string): ProjectSession => ({
    id,
    title: id,
    createdAt,
    dir: `/sessions/${id}`,
    cwd: '/proj',
    ...(parentSession === undefined ? {} : { parentSession }),
  })

  it('renders multiple fork generations parent-first with stable depths', () => {
    const rows = sessionLineage([
      session('grandchild', 4, 'child'),
      session('unrelated', 3),
      session('root', 1),
      session('child', 2, 'root'),
    ])
    expect(rows.map(row => [row.id, row.depth])).toEqual([
      ['root', 0],
      ['child', 1],
      ['grandchild', 2],
      ['unrelated', 0],
    ])
  })

  it('keeps orphaned and cyclic sessions resumable as roots', () => {
    const rows = sessionLineage([
      session('orphan', 3, 'missing'),
      session('a', 2, 'b'),
      session('b', 1, 'a'),
    ])
    expect(new Set(rows.map(row => row.id))).toEqual(new Set(['orphan', 'a', 'b']))
    expect(rows.find(row => row.id === 'orphan')?.depth).toBe(0)
  })
})
