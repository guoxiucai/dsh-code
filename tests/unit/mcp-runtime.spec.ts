import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upsertMcpServer } from '../../src/tui/mcp-config.ts'
import { McpRuntimeManager, type McpMount } from '../../src/tui/mcp-runtime.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('MCP runtime hot reload', () => {
  it('mounts an imported server and publishes connected state without restarting the process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-runtime-'))
    dirs.push(root)
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    const tools = new Set<string>()
    const mounted: string[] = []
    const disposed: string[] = []
    const mount: McpMount = async (config) => {
      mounted.push(config.serverName)
      tools.add(`mcp__${config.serverName}__ping`)
      return {
        async dispose() {
          disposed.push(config.serverName)
          tools.delete(`mcp__${config.serverName}__ping`)
        },
      }
    }
    const manager = new McpRuntimeManager({ home, cwd, mount, toolNames: () => [...tools], pollIntervalMs: 0 })
    const states: string[] = []
    manager.subscribe(snapshot => { states.push(snapshot.map(entry => `${entry.serverName}:${entry.state}`).join(',')) })

    await manager.start()
    upsertMcpServer(home, cwd, 'user', {
      serverName: 'live', transport: 'stdio', command: 'fixture-server', args: [], enabled: true,
    })
    await manager.reload()

    expect(mounted).toEqual(['live'])
    expect(manager.snapshot()).toMatchObject([{ scope: 'user', serverName: 'live', state: 'connected', toolCount: 1 }])
    expect(states).toContain('live:connecting')
    expect(states.at(-1)).toBe('live:connected')

    upsertMcpServer(home, cwd, 'user', {
      serverName: 'live', transport: 'stdio', command: 'fixture-server', args: [], enabled: false,
    })
    await manager.reload()
    expect(disposed).toEqual(['live'])
    expect(manager.snapshot()).toMatchObject([{ serverName: 'live', state: 'disabled', toolCount: 0 }])
    await manager.dispose()
  })
})
