/** Pure helpers shared by the inline provider-configuration wizard. */

/** Derive a conventional credential reference from a local provider id. */
export function credentialEnvName(providerId: string): string {
  const normalized = providerId
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return `${normalized === '' ? 'PROVIDER' : normalized}_API_KEY`
}
