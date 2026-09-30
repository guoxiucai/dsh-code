import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { initDshCodeProfile, tuiProfileConflict } from '../../src/bootstrap/profile.ts'

it('identifies the ACP argv conflict and preserves --resume forwarding in the TUI profile', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-code-resume-profile-'))
  const dir = initDshCodeProfile(home, new URL('../fixtures/resume-args-smoke.mjs', import.meta.url).href, home)
  const path = join(dir, 'package.json')
  const original = readFileSync(path, 'utf8')
  const manifest = JSON.parse(original)
  manifest.dsh.profile.bundles.push('@deepseek-ai/dsh-acp-app')
  const run = () => new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../deepseek-harness/apps/cli/lib/bin.js', import.meta.url)),
      '--profile', 'dsh-code', '--resume', 'selected-session'], {
      cwd: home, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => { resolve({ code, stdout, stderr }) })
  })
  try {
    writeFileSync(path, JSON.stringify(manifest))
    expect(tuiProfileConflict(home)).toContain('@deepseek-ai/dsh-acp-app')
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(manifest))
    const conflicted = await run()
    expect(conflicted.code).not.toBe(0)
    expect(conflicted.stderr).toContain("unknown option '--resume'")

    writeFileSync(path, original)
    expect(tuiProfileConflict(home)).toBeUndefined()
    const healthy = await run()
    expect(healthy.code).toBe(0)
    expect(healthy.stderr).toBe('')
    expect(JSON.parse(healthy.stdout)).toEqual({ args: ['--resume', 'selected-session'] })
  } finally { rmSync(home, { recursive: true, force: true }) }
}, 30000)
