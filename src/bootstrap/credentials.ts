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

/** True when the managed credential document contains a non-empty string value. */
export function hasStoredCredential(home: string): boolean {
  try {
    const document = load(readFileSync(join(home, '.credentials.yaml'), 'utf8'))
    if (document === null || typeof document !== 'object' || Array.isArray(document)) return false
    return Object.values(document as Record<string, unknown>)
      .some(value => typeof value === 'string' && value.length > 0)
  } catch {
    // Missing, unreadable, or invalid documents are not usable credential stores.
    // The upstream provider remains responsible for reporting malformed files.
    return false
  }
}
