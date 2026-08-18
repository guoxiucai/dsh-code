import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'
import { deleteSession, listAllSessions, listProjectSessions, projectKey } from '../../src/bootstrap/sessions.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** Write a session log with a header and an optional first human user message. */
function writeSessionLog(sessionDir: string, id: string, createdAt: number, title?: string, cwd?: string): void {
  mkdirSync(sessionDir, { recursive: true })
  const header = JSON.stringify({ type: 'session', id, createdAt, ...(cwd === undefined ? {} : { cwd }) })
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
})
