import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  effectiveMcpServers,
  createEphemeralMcpPatch,
  listManagedMcpServers,
  migrateLegacyProjectMcpConfig,
  readMcpConfig,
  setMcpServerEnabled,
  upsertMcpServer,
} from '../../src/tui/mcp-config.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture(): { home: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-config-'))
  dirs.push(root)
  return { home: join(root, 'home'), cwd: join(root, 'project') }
}

describe('dsh-code MCP configuration', () => {
  it('keeps user and project imports independent and lets project scope override by namespace', () => {
    const { home, cwd } = fixture()
    upsertMcpServer(home, cwd, 'user', {
      serverName: 'shared', transport: 'stdio', command: 'user-server', args: [], enabled: true,
      origin: { product: 'claude', serverName: 'shared', sourcePath: '/source/.claude.json' },
    })
    upsertMcpServer(home, cwd, 'project', {
      serverName: 'shared', transport: 'stdio', command: 'project-server', args: [], enabled: true,
      origin: { product: 'codex', serverName: 'shared', sourcePath: '/source/config.toml' },
    })
    upsertMcpServer(home, cwd, 'user', {
      serverName: 'optional', transport: 'streamable-http', url: 'https://example.test/mcp', enabled: true,
    })
    setMcpServerEnabled(home, cwd, 'user', 'optional', false)

    expect(listManagedMcpServers(home, cwd).map(server => [server.scope, server.serverName, server.effective])).toEqual([
      ['user', 'optional', true],
      ['user', 'shared', false],
      ['project', 'shared', true],
    ])
    expect(effectiveMcpServers(home, cwd).map(server => [server.serverName, server.command])).toEqual([
      ['shared', 'project-server'],
    ])
    expect(readMcpConfig(home, cwd, 'user').find(server => server.serverName === 'shared')?.origin?.product).toBe('claude')
    expect(statSync(join(home, 'mcp.json')).mode & 0o777).toBe(0o600)
  })

  it('migrates legacy MCP patch rows while preserving unrelated project plugins', () => {
    const { home, cwd } = fixture()
    mkdirSync(join(cwd, '.dsh-code'), { recursive: true })
    const patchPath = join(cwd, '.dsh-code', 'cordis.patch.yml')
    writeFileSync(patchPath, `- insert:\n    - id: keep-plugin\n      name: example\n    - id: mcp-legacy\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: legacy\n        transport: stdio\n        command: node\n        args: [server.js]\n`)

    expect(migrateLegacyProjectMcpConfig(home, cwd)).toBe(1)
    expect(readMcpConfig(home, cwd, 'project')).toMatchObject([
      { serverName: 'legacy', command: 'node', enabled: true },
    ])
    expect(readFileSync(patchPath, 'utf8')).toContain('keep-plugin')
    expect(readFileSync(patchPath, 'utf8')).not.toContain('mcp-legacy')
  })

  it('materializes and cleans up a private headless runtime patch', () => {
    const { home, cwd } = fixture()
    upsertMcpServer(home, cwd, 'user', {
      serverName: 'remote', transport: 'streamable-http', url: 'https://example.test/mcp',
      headers: { Authorization: 'private' }, enabled: true,
    })

    const patch = createEphemeralMcpPatch(home, cwd)
    expect(patch).toBeDefined()
    expect(readFileSync(patch!.path, 'utf8')).toContain('@deepseek-ai/dsh-mcp-client')
    expect(statSync(patch!.path).mode & 0o777).toBe(0o600)
    patch!.dispose()
    expect(() => statSync(patch!.path)).toThrow()
  })
})
