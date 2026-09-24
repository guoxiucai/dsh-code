import { describe, expect, it } from 'vitest'
import { platformKey, unsupportedPlatformMessage } from '../../src/cli/platform.ts'

describe('platform support', () => {
  it('accepts the supported platform combinations', () => {
    expect(unsupportedPlatformMessage('darwin', 'arm64')).toBeUndefined()
    expect(unsupportedPlatformMessage('win32', 'x64')).toBeUndefined()
    expect(unsupportedPlatformMessage('linux', 'x64')).toBeUndefined()
  })

  it('rejects cross combinations and reports the actual target', () => {
    expect(unsupportedPlatformMessage('darwin', 'x64')).toContain('darwin-x64')
    expect(unsupportedPlatformMessage('win32', 'arm64')).toContain('win32-arm64')
    expect(unsupportedPlatformMessage('linux', 'arm64')).toContain('linux-arm64')
    expect(platformKey('linux', 'x64')).toBe('linux-x64')
  })

  it('rejects Linux arm64 until product support is verified', () => {
    expect(unsupportedPlatformMessage('linux', 'arm64')).toBe(
      `unsupported platform linux-arm64; supported platforms are macOS arm64, Windows 10+ x64, and Linux x64`,
    )
  })
})
