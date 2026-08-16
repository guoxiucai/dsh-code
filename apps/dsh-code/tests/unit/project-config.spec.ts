import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addMcpServer, removeMcpServer, projectPatchPath } from '../../src/tui/project-config.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('project-config', () => {
  it('adds an MCP server row as a patch entry', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-'))
    dirs.push(cwd)
    addMcpServer(cwd, { serverName: 'test', transport: 'stdio', command: 'npx', args: ['-y', 'x'] })
    const text = readFileSync(projectPatchPath(cwd), 'utf8')
    expect(text).toContain('mcp-test')
    expect(text).toContain('@deepseek-ai/dsh-mcp-client')
    expect(text).toContain('transport: stdio')
    expect(text).toContain('npx')
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
})
