import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasStoredCredential } from '../../src/bootstrap/credentials.ts'

const homes: string[] = []

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-code-credentials-'))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
})

describe('first-run credential detection', () => {
  it('requests onboarding when the managed document does not exist', () => {
    expect(hasStoredCredential(makeHome())).toBe(false)
  })

  it('requests onboarding for empty and comments-only documents', () => {
    const home = makeHome()
    const path = join(home, '.credentials.yaml')

    writeFileSync(path, '# no model token yet\n')
    expect(hasStoredCredential(home)).toBe(false)
    writeFileSync(path, '{}\n')
    expect(hasStoredCredential(home)).toBe(false)
  })

  it('skips onboarding once any non-empty credential has been saved', () => {
    const home = makeHome()
    writeFileSync(join(home, '.credentials.yaml'), 'MY_GATEWAY_TOKEN: sk-saved\n')

    expect(hasStoredCredential(home)).toBe(true)
  })

  it('does not treat malformed or non-string values as usable credentials', () => {
    const home = makeHome()
    const path = join(home, '.credentials.yaml')

    writeFileSync(path, 'bad: [unterminated\n')
    expect(hasStoredCredential(home)).toBe(false)
    writeFileSync(path, 'TOKEN: 123\n')
    expect(hasStoredCredential(home)).toBe(false)
  })
})
