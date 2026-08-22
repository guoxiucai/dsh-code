import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compatibleSkillDirs, initDshCodeProfile, skillProjectRoot } from '../../src/bootstrap/profile.ts'

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
  it('mounts the upstream ask-user tool before the TUI answer provider', () => {
    const home = makeHome()
    const pluginUrl = 'file:///installed/dsh-code/lib/tui/plugin.js'
    const dir = initDshCodeProfile(home, pluginUrl)
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')

    expect(patch).toContain("id: dsh-code-tool-ask-user\n      name: '@deepseek-ai/dsh-tool-ask-user'")
    expect(patch).toContain(`id: dsh-code-tui\n      name: ${JSON.stringify(pluginUrl)}`)
    expect(patch.indexOf('dsh-code-tool-ask-user')).toBeLessThan(patch.indexOf('dsh-code-tui'))
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
})
