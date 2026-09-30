import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compatibleSkillDirs,
  DEFAULT_AGENT_PRESET,
  initDshCodeProfile,
  skillProjectRoot,
} from '../../src/bootstrap/profile.ts'

const homes: string[] = []

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-code-profile-'))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
})

describe('dsh-code profile composition', () => {
  it('moves model-facing rows into the upstream standard Agent Preset', () => {
    const home = makeHome()
    const dir = initDshCodeProfile(home, 'file:///plugin.js')
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')

    expect(DEFAULT_AGENT_PRESET).toBe('standard')
    expect(patch).toContain("id: agent-preset-registry\n      name: '@deepseek-ai/dsh-agent-preset-registry'")
    expect(patch).toContain('default: standard')
    // The upstream base now owns the shared Node-process PTC runtime.
    expect(patch).not.toContain('dsh-code-runtime-worker-thread')
    expect(patch).toContain('id: workflow-ptc\n  disabled: true')
    for (const id of [
      'tool-bash',
      'tool-pwsh',
      'tool-fs',
      'skill-filesystem',
      'plan-mode',
      'command-compact',
      'tool-subagent',
      'tool-todo',
      'tool-web',
    ]) {
      expect(patch).toContain(`- id: ${id}\n  disabled: true`)
    }
  })

  it('loads upstream preset declarations with scoped ask-user tools', () => {
    const home = makeHome()
    const pluginUrl = 'file:///installed/dsh-code/lib/tui/plugin.js'
    const dir = initDshCodeProfile(home, pluginUrl)
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')

    expect(patch).toContain("name: '@deepseek-ai/dsh-tool-ask-user'")
    expect(patch).toContain('id: preset-standard')
    expect(patch).toContain('id: preset-ptc')
    expect(patch).toContain(`id: dsh-code-tui\n      name: ${JSON.stringify(pluginUrl)}`)
    expect(patch).not.toContain('id: dsh-code-tool-ask-user')
  })

  it('delegates compatible skill discovery to an isolated upstream filesystem provider', () => {
    const home = makeHome()
    const project = join(home, 'project')
    const userHome = join(home, 'user')
    expect(compatibleSkillDirs(project, userHome)).toEqual([
      join(project, '.codex', 'skills'),
      join(project, '.claude', 'skills'),
      join(userHome, '.dsh', 'skills'),
      join(userHome, '.codex', 'skills'),
      join(userHome, '.claude', 'skills'),
    ])

    const dir = initDshCodeProfile(home, 'file:///plugin.js', project)
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
    expect(patch).toContain('providerName: dsh-code-compatible-filesystem')
    expect(patch).toContain(JSON.stringify(join(project, '.codex', 'skills')))
    expect(patch).toContain(JSON.stringify(join(project, '.claude', 'skills')))
    expect(patch).not.toContain('includeDefaultRoots: true')
  })

  it('discovers compatible project skills from the nearest git root', () => {
    const root = makeHome()
    const nested = join(root, 'packages', 'app')
    mkdirSync(join(root, '.git'))
    mkdirSync(nested, { recursive: true })

    expect(skillProjectRoot(nested)).toBe(root)
    const dir = initDshCodeProfile(makeHome(), 'file:///plugin.js', nested)
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain(JSON.stringify(join(root, '.codex', 'skills')))
    expect(patch).not.toContain(JSON.stringify(join(nested, '.codex', 'skills')))
  })

  it('refreshes generated product rows without overwriting the profile manifest', () => {
    const home = makeHome()
    const dir = initDshCodeProfile(home, 'file:///first/plugin.js')
    const manifestPath = join(dir, 'package.json')
    writeFileSync(manifestPath, '{"private":true,"marker":"keep"}\n')

    initDshCodeProfile(home, 'file:///second/plugin.js')

    expect(readFileSync(manifestPath, 'utf8')).toContain('"marker":"keep"')
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('file:///second/plugin.js')
  })

  it('preserves profile-backed settings and user plugins when refreshing or relocating the TUI', () => {
    const home = makeHome()
    const dir = initDshCodeProfile(home, 'file:///first/plugin.js')
    const path = join(dir, 'cordis.patch.yml')
    appendFileSync(path, `
- id: agent-default-model
  config: { provider: custom, model: saved-model }
- id: llm-pi-ai
  config:
    providers:
      custom: { baseURL: 'https://example.com/v1', apiKeyEnv: CUSTOM_KEY }
- insert:
    - id: custom-plugin
      name: custom-plugin
      disabled: !!js process.platform === 'win32'
`)
    initDshCodeProfile(home, 'file:///second/plugin.js')
    initDshCodeProfile(home, 'file:///third/plugin.js')
    const patch = readFileSync(path, 'utf8')
    expect(patch).toContain('saved-model')
    expect(patch).toContain('CUSTOM_KEY')
    expect(patch).toContain('https://example.com/v1')
    expect(patch).toContain("!!js process.platform === 'win32'")
    expect(patch.match(/id: custom-plugin/g)).toHaveLength(1)
    expect(patch.match(/id: preset-standard/g)).toHaveLength(1)
    expect(patch).toContain('file:///third/plugin.js')
    expect(patch).not.toContain('file:///first/plugin.js')
  })
})
