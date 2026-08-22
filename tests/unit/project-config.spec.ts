import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addMcpServer, listMcpServers, parseMcpArguments, removeMcpServer, projectPatchPath } from '../../src/tui/project-config.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('project-config', () => {
  it('parses MCP argv as a cross-platform JSON array', () => {
    expect(parseMcpArguments('["-y","server name"]')).toEqual(['-y', 'server name'])
    expect(() => parseMcpArguments('-y server')).toThrow('JSON string array')
    expect(() => parseMcpArguments('["ok",1]')).toThrow('JSON string array')
  })

  it('adds an MCP server row as a patch entry', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-'))
    dirs.push(cwd)
    addMcpServer(cwd, { serverName: 'test', transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'private' }, cwd: '/tmp' })
    const text = readFileSync(projectPatchPath(cwd), 'utf8')
    expect(text).toContain('mcp-test')
    expect(text).toContain('@deepseek-ai/dsh-mcp-client')
    expect(text).toContain('transport: stdio')
    expect(text).toContain('npx')
    expect(text).toContain('TOKEN')
    expect(text).toContain('/tmp')
  })

  it('replaces a prior row with the same server name instead of duplicating', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-'))
    dirs.push(cwd)
    addMcpServer(cwd, { serverName: 'test', transport: 'stdio', command: 'npx', args: ['-y', 'a'] })
    addMcpServer(cwd, { serverName: 'test', transport: 'stdio', command: 'npx', args: ['-y', 'b'] })
    const text = readFileSync(projectPatchPath(cwd), 'utf8')
    expect(text.split('mcp-test').length - 1).toBe(1)
  })

  it('removes an MCP server row', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-'))
    dirs.push(cwd)
    addMcpServer(cwd, { serverName: 'test', transport: 'streamable-http', url: 'https://mcp.example.com' })
    removeMcpServer(cwd, 'test')
    expect(readFileSync(projectPatchPath(cwd), 'utf8')).not.toContain('mcp-test')
  })

  it('lists stdio and Streamable HTTP rows in stable name order', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-'))
    dirs.push(cwd)
    addMcpServer(cwd, { serverName: 'z-http', transport: 'streamable-http', url: 'https://mcp.example.com/mcp' })
    addMcpServer(cwd, { serverName: 'a-stdio', transport: 'stdio', command: 'npx', args: ['-y', 'server'] })

    expect(listMcpServers(cwd)).toEqual([
      { serverName: 'a-stdio', transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: {} },
      { serverName: 'z-http', transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {} },
    ])
  })

  it('preserves unrelated siblings when replacing or removing one MCP row', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-'))
    dirs.push(cwd)
    mkdirSync(join(cwd, '.dsh-code'), { recursive: true })
    writeFileSync(projectPatchPath(cwd), `- insert:\n    - id: keep-plugin\n      name: example\n    - id: mcp-test\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: test\n        transport: stdio\n        command: old\n        args: []\n`)

    addMcpServer(cwd, { serverName: 'test', transport: 'stdio', command: 'new', args: [] })
    expect(readFileSync(projectPatchPath(cwd), 'utf8')).toContain('keep-plugin')
    removeMcpServer(cwd, 'test')
    const text = readFileSync(projectPatchPath(cwd), 'utf8')
    expect(text).toContain('keep-plugin')
    expect(text).not.toContain('mcp-test')
  })
})
