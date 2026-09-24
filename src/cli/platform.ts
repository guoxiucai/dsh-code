/** Supported product platform combinations. */
export const SUPPORTED_PLATFORMS = new Set(['darwin-arm64', 'win32-x64', 'linux-x64'])

export function platformKey(platform = process.platform, arch = process.arch): string {
  return `${platform}-${arch}`
}

export function unsupportedPlatformMessage(platform = process.platform, arch = process.arch): string | undefined {
  const actual = platformKey(platform, arch)
  if (SUPPORTED_PLATFORMS.has(actual)) return undefined
  return `unsupported platform ${actual}; supported platforms are macOS arm64, Windows 10+ x64, and Linux x64`
}
