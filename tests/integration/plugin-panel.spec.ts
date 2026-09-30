import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { initDshCodeProfile } from '../../src/bootstrap/profile.ts'

const require = createRequire(import.meta.url)
const dshBin = fileURLToPath(new URL('../../deepseek-harness/apps/cli/lib/bin.js', import.meta.url))
const fixture = new URL('../fixtures/plugin-panel-smoke.mjs', import.meta.url).href

it('installs a local bundle from the panel, toggles its real tool, persists across restart, and uninstalls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-code-plugin-panel-'))
  const home = join(root, 'home')
  const source = join(root, 'bundle')
  mkdirSync(source)
  writeFileSync(join(source, 'package.json'), JSON.stringify({
    name: '@dsh-code-test/plugin-panel', version: '1.0.0', type: 'module',
    exports: './index.mjs', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  writeFileSync(join(source, 'cordis.patch.yml'), '- insert:\n    - id: plugin-panel-ping\n      name: "@dsh-code-test/plugin-panel"\n')
  // Use the installation's real tool definition helper, without fetching dependencies.
  writeFileSync(join(source, 'index.mjs'), `
import { defineTool } from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href)}
export const name = 'plugin-panel-ping'
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register(defineTool({ name: 'plugin_panel_ping', description: 'Plugin panel integration tool',
    parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'pong' },
  }))
}
`)
  async function run(phase: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', require.resolve('tsx/esm'), dshBin, '--profile', 'dsh-code'], {
        cwd: root, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
          DSH_PERMISSION_MODE: 'danger-full-access', PLUGIN_PANEL_PHASE: phase, PLUGIN_PANEL_BUNDLE: source },
      })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Plugin smoke timed out: ${stderr}\n${stdout}`)) }, 60000)
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    })
  }
  try {
    const dir = initDshCodeProfile(home, fixture, root)
    const installed = await run('install')
    expect(installed.stderr).toBe('')
    expect(installed.code, installed.stdout).toBe(0)
    expect(JSON.parse(installed.stdout)).toMatchObject({ phase: 'install', toolVisible: true })
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('@dsh-code-test/plugin-panel')
    initDshCodeProfile(home, fixture, root)
    const removed = await run('remove')
    expect(removed.stderr).toBe('')
    expect(removed.code, removed.stdout).toBe(0)
    expect(JSON.parse(removed.stdout)).toMatchObject({ phase: 'remove', toolVisible: false })
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies ?? {})
      .not.toHaveProperty('@dsh-code-test/plugin-panel')
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 120000)
