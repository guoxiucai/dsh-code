/**
 * Read-only first-run credential detection. Secret writes and resolution stay
 * owned by the upstream credentials service; this module only decides whether
 * the interactive TUI should open its existing model configuration wizard.
 * @module dsh-code/bootstrap/credentials
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'

/** Private launcher-to-TUI signal; always cleared before ordinary delegation. */
export const FIRST_MODEL_CONFIG_ENV = 'DSH_CODE_FIRST_MODEL_CONFIG'

function mapping(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** True when either the legacy flat store or upstream's versioned store has a credential. */
export function hasStoredCredential(home: string): boolean {
  try {
    const document = mapping(load(readFileSync(join(home, '.credentials.yaml'), 'utf8')))
    if (document === undefined) return false

    // DSH 0.1.1 migrates the former flat REF: value mapping to version 1 with
    // separate reference and provider-record key spaces. A record may validly
    // represent OAuth, provider environment, or an ambient credential chain,
    // so its presence is sufficient even when it has no literal API key.
    if ('version' in document) {
      if (document.version !== 1) return false
      if (Object.keys(document).some(key => key !== 'version' && key !== 'refs' && key !== 'records')) return false
      const refs = mapping(document.refs)
      const records = mapping(document.records)
      return Object.values(refs ?? {}).some(value => typeof value === 'string' && value.length > 0)
        || Object.keys(records ?? {}).length > 0
    }

    // Compatibility with the pre-release flat layout. Upstream performs the
    // authoritative validation and migration when its provider boots.
    return Object.values(document).some(value => typeof value === 'string' && value.length > 0)
  } catch {
    // Missing, unreadable, or invalid documents are not usable credential stores.
    // The upstream provider remains responsible for reporting malformed files.
    return false
  }
}
