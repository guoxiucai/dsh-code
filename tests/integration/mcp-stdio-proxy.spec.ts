import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('dsh-code MCP stdio proxy', () => {
  it('keeps a server stderr banner out of the parent TUI stream and writes a private log', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-code-mcp-proxy-'))
    dirs.push(root)
    const logPath = join(root, 'noisy.stderr.log')
    const proxyPath = fileURLToPath(new URL('../../src/tui/mcp-stdio-proxy.ts', import.meta.url))
    const marker = 'NOISY_MCP_BANNER_MUST_NOT_REACH_TUI'
    const child = spawn(process.execPath, [
      proxyPath,
      process.execPath,
      '-e',
      `process.stderr.write(${JSON.stringify(marker)}); process.exit(0)`,
    ], {
      env: { ...process.env, DSH_CODE_MCP_STDERR_LOG: logPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })

    expect(code).toBe(0)
    expect(stderr).not.toContain(marker)
    expect(readFileSync(logPath, 'utf8')).toContain(marker)
  })
})
