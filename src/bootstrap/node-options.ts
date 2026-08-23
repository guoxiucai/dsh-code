/** Append one ESM preload without disturbing caller-supplied Node options. */
export function appendNodeImport(existing: string | undefined, moduleUrl: string): string {
  const preload = `--import=${moduleUrl}`
  const current = existing?.trim()
  return current === undefined || current.length === 0 ? preload : `${current} ${preload}`
}
