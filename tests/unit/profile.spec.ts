import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDshCodeProfile } from '../../src/bootstrap/profile.ts'

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
