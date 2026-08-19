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
})
