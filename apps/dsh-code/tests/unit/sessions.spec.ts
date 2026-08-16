import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjectSessions, projectKey } from '../../src/bootstrap/sessions.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

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

  it('lists session directories for the project with their createdAt', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-home-'))
    dirs.push(home)
    const sessionDir = join(home, 'sessions', projectKey('/proj'), 'session-abc')
    mkdirSync(sessionDir, { recursive: true })
    // Plain header line (uncompressed path).
    writeFileSync(join(sessionDir, 'session.jsonl'), JSON.stringify({ type: 'session', id: 'session-abc', createdAt: 1700000000000 }) + '\n')
    const sessions = listProjectSessions(home, '/proj')
    expect(sessions).toEqual([{ id: 'session-abc', createdAt: 1700000000000 }])
  })
})
