import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { upsertMcpServer } from '../../src/tui/mcp-config.ts'
import { cordisMcpMount, McpRuntimeManager } from '../../src/tui/mcp-runtime.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('live dsh-code MCP runtime', () => {
  it('connects and unloads a newly imported stdio server in the same Cordis process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-code-live-mcp-'))
    dirs.push(root)
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    const fixtureServer = fileURLToPath(new URL('../fixtures/noisy-mcp-fixture.mjs', import.meta.url))
    const stderrLogDir = join(root, 'logs')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const manager = new McpRuntimeManager({
      home,
      cwd,
      mount: cordisMcpMount(ctx, { stderrLogDir }),
      toolNames: () => ctx.tools.schemas().map(schema => schema.name),
      pollIntervalMs: 0,
    })

    try {
      await manager.start()
      upsertMcpServer(home, cwd, 'project', {
        serverName: 'live',
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServer],
        cwd: dirname(fixtureServer),
        enabled: true,
      })
      await manager.reload()

      expect(manager.snapshot()).toMatchObject([{ serverName: 'live', state: 'connected' }])
      expect(ctx.tools.schemas().map(schema => schema.name)).toContain('mcp__live__add')

      upsertMcpServer(home, cwd, 'project', {
        serverName: 'live', transport: 'stdio', command: process.execPath,
        args: [fixtureServer], cwd: dirname(fixtureServer), enabled: false,
      })
      await manager.reload()
      expect(manager.snapshot()).toMatchObject([{ serverName: 'live', state: 'disabled' }])
      expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('mcp__live__add')

      upsertMcpServer(home, cwd, 'project', {
        serverName: 'live', transport: 'stdio', command: process.execPath,
        args: [fixtureServer], cwd: dirname(fixtureServer), enabled: true,
      })
      await manager.reload()
      expect(manager.snapshot()).toMatchObject([{ serverName: 'live', state: 'connected' }])
      expect(ctx.tools.schemas().map(schema => schema.name)).toContain('mcp__live__add')
      const stderrLog = readFileSync(join(stderrLogDir, 'live.stderr.log'), 'utf8')
      // MCP SDK v2 starts a discovery child and a fresh session child for each
      // stdio connection. Two explicit mounts therefore emit four banners.
      expect(stderrLog.match(/NOISY_MCP_FIXTURE_BANNER/g), stderrLog).toHaveLength(4)
    } finally {
      await manager.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)
})
