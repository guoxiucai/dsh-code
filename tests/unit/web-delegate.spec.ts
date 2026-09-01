import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  delegateWebProcess,
  parseWebReadyLine,
  webDshArgs,
} from '../../src/cli/delegate.ts'

const fixture = fileURLToPath(new URL('../fixtures/web-process-child.mjs', import.meta.url))

describe('Web profile delegation', () => {
  it('owns the package-local Web profile and OS-selected port arguments', () => {
    expect(webDshArgs(['--patch', '/trusted/project.yml'])).toEqual([
      '--profile', 'web', '--patch', '/trusted/project.yml', '--port', '0',
    ])
  })

  it('extracts only the authenticated upstream readiness line', () => {
    expect(parseWebReadyLine('dsh web: http://127.0.0.1:3080/?token=secret')).toBe(
      'http://127.0.0.1:3080/?token=secret',
    )
    expect(parseWebReadyLine('dsh web: opening the default browser')).toBeUndefined()
    expect(parseWebReadyLine('http://127.0.0.1:3080')).toBeUndefined()
  })

  it('frames split output, reports readiness, and waits for requested shutdown', async () => {
    let resolveReady: ((url: string) => void) | undefined
    const ready = new Promise<string>((resolve) => { resolveReady = resolve })
    const handle = delegateWebProcess(fixture, ['ready'], {
      env: process.env,
      onReady: url => { resolveReady?.(url) },
    })

    await expect(ready).resolves.toBe('http://127.0.0.1:45678/?token=test-token')
    handle.stop()
    await expect(handle.result).resolves.toMatchObject({
      readyUrl: 'http://127.0.0.1:45678/?token=test-token',
      stopRequested: true,
    })
  })

  it('keeps failure output bounded in the result', async () => {
    const handle = delegateWebProcess(fixture, ['failed'], { env: process.env })
    await expect(handle.result).resolves.toEqual({
      code: 7,
      stopRequested: false,
      diagnostics: ['web boot failed'],
    })
  })
})
