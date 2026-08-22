import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { initDshCodeProfile } from '../../src/bootstrap/profile.ts'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const dshBin = join(repoRoot, 'deepseek-harness/apps/cli/lib/bin.js')
const smokePlugin = fileURLToPath(new URL('../fixtures/standard-preset-smoke.mjs', import.meta.url))
const dirs: string[] = []

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function run(home: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [dshBin, '--profile', 'dsh-code'], {
      cwd,
      env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', code => { resolve({ stdout, stderr, code: code ?? 1 }) })
  })
}

describe('standard Agent Preset composition', () => {
  it('boots the official standard preset and keeps its model tools out of the global layer', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-code-standard-home-'))
    const project = mkdtempSync(join(tmpdir(), 'dsh-code-standard-project-'))
    dirs.push(home, project)
    initDshCodeProfile(home, pathToFileURL(smokePlugin).href, project)

    const result = await run(home, project)

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout.trim()) as {
      preset: string
      headerPreset: string
      agentTools: string[]
      globalTools: string[]
    }
    expect(report.preset).toBe('standard')
    expect(report.headerPreset).toBe('standard')
    expect(report.agentTools).toEqual(expect.arrayContaining(['bash', 'read', 'write', 'edit', 'todo_write']))
    expect(report.globalTools).not.toEqual(expect.arrayContaining(['bash', 'read', 'write', 'edit', 'todo_write']))
  }, 60_000)
})
