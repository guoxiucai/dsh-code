import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  connectedMcpServerNames,
  discoverExternalMcpServers,
  externalMcpSourceLabel,
} from '../../src/tui/external-mcp.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture(): { project: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-code-external-mcp-'))
  dirs.push(root)
  const project = join(root, 'project')
  const home = join(root, 'home')
  mkdirSync(join(project, '.git'), { recursive: true })
  mkdirSync(home, { recursive: true })
  return { project, home }
}

describe('external MCP discovery', () => {
  it('formats grouped source headings and derives live connection state from tool names', () => {
    const server = {
      id: 'claude-id', product: 'claude', scope: 'user', sourcePath: '/test/home/.claude.json',
      sourceEnabled: true, warnings: [], serverName: 'fullsdk', transport: 'stdio', command: 'node',
    } as const
    expect(externalMcpSourceLabel(server, '/test/home')).toBe('Claude Code (~/.claude.json):')
    expect([...connectedMcpServerNames(['read', 'mcp__fullsdk__search', 'mcp__gitlab__issues'])]).toEqual(['fullsdk', 'gitlab'])
  })

  it('discovers project and user Codex TOML servers', () => {
    const { project, home } = fixture()
    mkdirSync(join(project, '.codex'), { recursive: true })
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(project, '.codex', 'config.toml'), '[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp"]\n')
    writeFileSync(join(home, '.codex', 'config.toml'), '[mcp_servers.remote]\nurl = "https://mcp.example.com/mcp"\nenabled = false\n')
    const servers = discoverExternalMcpServers({ cwd: project, userHome: home })
    expect(servers.map(server => [server.product, server.scope, server.serverName, server.sourceEnabled])).toEqual([
      ['codex', 'project', 'docs', true],
      ['codex', 'user', 'remote', false],
    ])
  })

  it('discovers Claude user/project configs and standalone DSH profile rows', () => {
    const { project, home } = fixture()
    writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { claudeProject: { command: 'node', args: ['server.js'] } } }))
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { claudeUser: { type: 'http', url: 'https://claude.example/mcp', headers: { Authorization: 'secret' } } } }))
    const profile = join(home, '.dsh', 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cordis.patch.yml'), `- insert:\n    - id: mcp-upstream\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        serverName: upstream\n        command: npx\n        args: [server]\n        env: {}\n`)

    const servers = discoverExternalMcpServers({ cwd: project, userHome: home })
    expect(servers.map(server => `${server.product}:${server.serverName}`).sort()).toEqual([
      'claude:claudeProject', 'claude:claudeUser', 'dsh:upstream',
    ])
    expect(servers.find(server => server.serverName === 'claudeUser')?.headers).toEqual({ Authorization: 'secret' })
  })

  it('does not scan dsh-code home as standalone DSH', () => {
    const { project, home } = fixture()
    const own = join(home, '.dsh-code', 'profiles', 'dsh-code')
    mkdirSync(own, { recursive: true })
    writeFileSync(join(own, 'cordis.patch.yml'), `- insert:\n    - name: '@deepseek-ai/dsh-mcp-client'\n      config: { transport: stdio, serverName: own, command: node }\n`)
    expect(discoverExternalMcpServers({ cwd: project, userHome: home })).toEqual([])
  })
})
