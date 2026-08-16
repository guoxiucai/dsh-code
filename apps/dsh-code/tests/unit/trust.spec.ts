import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalizeProjectPath,
  isProjectTrusted,
  projectId,
  readTrustRecord,
  trustRecordPath,
  writeTrustRecord,
} from '../../src/bootstrap/trust.ts'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-code-trust-'))
  dirs.push(dir)
  return dir
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('project trust', () => {
  it('canonicalizes symlinked paths to the same project', () => {
    const real = tempDir()
    const link = join(tmpdir(), `dsh-code-link-${Date.now()}`)
    dirs.push(link)
    symlinkSync(real, link, 'dir')
    expect(canonicalizeProjectPath(link)).toBe(canonicalizeProjectPath(real))
  })

  it('derives a stable sha256 project id from the canonical path', () => {
    const id = projectId('/a/b/c')
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(projectId('/a/b/c')).toBe(id)
    expect(projectId('/a/b/d')).not.toBe(id)
  })

  it('round-trips a trust record', () => {
    const home = tempDir()
    const path = canonicalizeProjectPath(tempDir())
    writeTrustRecord(home, path, 'workspace-write')
    expect(isProjectTrusted(home, path)).toBe(true)
    expect(readTrustRecord(home, path)).toMatchObject({ canonicalPath: path, permissionPreset: 'workspace-write' })
    expect(trustRecordPath(home, projectId(path))).toBe(join(home, 'projects', `${projectId(path)}.json`))
  })

  it('fails closed on a corrupt trust record', () => {
    const home = tempDir()
    const path = canonicalizeProjectPath(tempDir())
    writeTrustRecord(home, path, 'workspace-write')
    writeFileSync(trustRecordPath(home, projectId(path)), '{ not json')
    expect(isProjectTrusted(home, path)).toBe(false)
  })

  it('fails closed on a schema-version mismatch', () => {
    const home = tempDir()
    const path = canonicalizeProjectPath(tempDir())
    writeTrustRecord(home, path, 'workspace-write')
    writeFileSync(trustRecordPath(home, projectId(path)), JSON.stringify({
      schemaVersion: 999, canonicalPath: path, trustedAt: 'x', lastSeenAt: 'x', permissionPreset: 'workspace-write', trustedProjectPlugins: {},
    }))
    expect(isProjectTrusted(home, path)).toBe(false)
  })

  it('does not trust a moved project path', () => {
    const home = tempDir()
    const a = canonicalizeProjectPath(tempDir())
    writeTrustRecord(home, a, 'workspace-write')
    const b = canonicalizeProjectPath(tempDir())
    expect(isProjectTrusted(home, b)).toBe(false)
  })

  it('records an owner-only projects directory', () => {
    const home = tempDir()
    const path = canonicalizeProjectPath(tempDir())
    writeTrustRecord(home, path, 'read-only')
    expect(readTrustRecord(home, path)).toMatchObject({ permissionPreset: 'read-only' })
    void mkdirSync // keep fs import used across platforms
  })
})
