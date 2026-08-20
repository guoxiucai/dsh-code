import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { mockOverlay } from '../../scripts/make-mock-overlay.mjs'

/** Repo root (tests/integration → ../..). */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const dshBin = join(repoRoot, 'deepseek-harness/apps/cli/lib/bin.js')
const mockAdapter = fileURLToPath(new URL('../fixtures/mock-adapter.mjs', import.meta.url))

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function run(dshArgs: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [dshBin, ...dshArgs], { cwd, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', code => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

describe('mock-LLM closed loop (headless composition)', () => {
  it('OPS/MODEL: runs a full tool round-trip turn and prints only the final answer', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-mock-'))
    dirs.push(home)
    const proj = mkdtempSync(join(tmpdir(), 'dsh-code-proj-'))
    dirs.push(proj)

    // Repoint the default model at the keyless mock adapter via a --patch overlay.
    // The overlay shape is defined once in scripts/make-mock-overlay.mjs.
    const overlay = mockOverlay(mockAdapter)
    const overlayPath = join(home, 'mock.cordis.yml')
    writeFileSync(overlayPath, overlay)

    // This test owns the project and verifies the model/tool round trip, not an
    // OS sandbox backend. GitHub-hosted Linux runners do not expose a usable
    // bwrap/Landlock backend, so use the upstream's explicit test override.
    const env = {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
      DSH_PERMISSION_MODE: 'danger-full-access',
    }
    const { stdout, stderr, code } = await run(
      ['--profile', 'headless', '--patch', overlayPath, 'prove the tool path'],
      proj,
      env,
    )
    expect(code).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toContain('DSH_CODE round trip complete')
    expect(stdout.trim()).toContain('DSH_CODE_TOOL_ROUND_TRIP')
  }, 60_000)

  it('OPS-003: a missing credential fails with a non-zero exit and no key on stdout', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-mock-'))
    dirs.push(home)
    const proj = mkdtempSync(join(tmpdir(), 'dsh-code-proj-'))
    dirs.push(proj)
    const { stdout, stderr, code } = await run(['--profile', 'headless', 'say hello'], proj, {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: '',
    })
    expect(code).not.toBe(0)
    expect(stdout.trim()).toBe('')
    expect(stderr).toContain('MISSING_CREDENTIAL')
  }, 60_000)
})
