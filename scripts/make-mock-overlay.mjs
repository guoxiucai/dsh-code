#!/usr/bin/env node
/**
 * Single source of truth for the keyless mock-LLM `--patch` overlay, shared by
 * the manual closed-loop check (docs/DEVELOPMENT.md §6) and the
 * `tests/integration/mock-loop.spec.ts` closed-loop test. `name` is the absolute
 * file URL of the mock adapter, so the overlay is portable across machines and
 * platforms instead of embedding a developer's home path.
 *
 * CLI usage:
 *   node scripts/make-mock-overlay.mjs [out-path]
 * Writes the overlay to `out-path` (default: a temp file) and prints that path
 * on stdout, so the caller can pass it straight to `--patch`.
 */

import { realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Build the overlay. `mockAdapterPath` is an absolute path to mock-adapter.mjs;
 * its `file://` URL is embedded as the plugin `name`.
 * @param {string} mockAdapterPath
 * @returns {string}
 */
export function mockOverlay(mockAdapterPath) {
  return [
    '- insert:',
    '    - id: dsh-code-mock-llm',
    `      name: ${JSON.stringify(pathToFileURL(mockAdapterPath).href)}`,
    '',
    '- id: agent-default-model',
    '  config:',
    '    provider: mock',
    '    model: mock',
    '',
  ].join('\n')
}

// Only write + print when run directly; importing the module (as the test does)
// must stay side-effect free.
const isMain = process.argv[1] !== undefined
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const mockAdapter = fileURLToPath(new URL('../tests/fixtures/mock-adapter.mjs', import.meta.url))
  const out = resolve(process.argv[2] ?? join(tmpdir(), `dsh-code-mock-${process.pid}.cordis.yml`))
  writeFileSync(out, mockOverlay(mockAdapter))
  console.log(out)
}
