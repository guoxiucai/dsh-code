/** Application entry bundles own argv/stdin and cannot share the TUI profile. */
const APPLICATION_PROFILES: Readonly<Record<string, string>> = {
  '@deepseek-ai/dsh-acp-app': 'acp',
  '@deepseek-ai/dsh-web-app': 'web',
  '@deepseek-ai/dsh-headless': 'headless',
  '@deepseek-ai/dsh-sdk-app': 'sdk',
  '@deepseek-ai/dsh-sdk-minimal': 'sdk-minimal',
}

/** Explain why a known standalone application bundle cannot be enabled in dsh-code. */
export function tuiBundleRestriction(name: string): string | undefined {
  const profile = Object.hasOwn(APPLICATION_PROFILES, name) ? APPLICATION_PROFILES[name] : undefined
  return profile === undefined ? undefined
    : `This starts the ${profile} application and conflicts with the TUI. Use its own ${profile} profile.`
}
