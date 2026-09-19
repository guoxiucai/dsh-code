import { describe, expect, it } from 'vitest'
import { platformKey, unsupportedPlatformMessage } from '../../src/cli/platform.ts'

describe('platform support', () => {
  it('accepts the two V1 platform combinations', () => {
    expect(unsupportedPlatformMessage('darwin', 'arm64')).toBeUndefined()
    expect(unsupportedPlatformMessage('win32', 'x64')).toBeUndefined()
  })

  it('rejects cross combinations and reports the actual target', () => {
    expect(unsupportedPlatformMessage('darwin', 'x64')).toContain('darwin-x64')
    expect(unsupportedPlatformMessage('win32', 'arm64')).toContain('win32-arm64')
    expect(platformKey('linux', 'x64')).toBe('linux-x64')
  })

  it.each(['x64', 'arm64'])('rejects Linux %s until product support is verified', (arch) => {
    expect(unsupportedPlatformMessage('linux', arch)).toBe(
      `unsupported platform linux-${arch}; supported platforms are macOS arm64 and Windows 10+ x64`,
    )
  })
})
