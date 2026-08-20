#!/usr/bin/env node
/**
 * Generates the keyless mock-LLM `--patch` overlay for the manual closed-loop
 * check (docs/DEVELOPMENT.md §6). Mirrors the overlay that
 * `tests/integration/mock-loop.spec.ts` builds inline: `name` is the absolute
 * file URL of `tests/fixtures/mock-adapter.mjs`, so the command is portable
 * across machines and platforms instead of embedding a developer's home path.
 *
 * Usage:
 *   node scripts/make-mock-overlay.mjs [out-path]
 *
 * Writes the overlay to `out-path` (default: a temp file) and prints that path
 * on stdout, so the caller can pass it straight to `--patch`.
 */

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const mockAdapter = fileURLToPath(new URL('../tests/fixtures/mock-adapter.mjs', import.meta.url))

const overlay = [
  '- insert:',
  '    - id: dsh-code-mock-llm',
  `      name: ${JSON.stringify(pathToFileURL(mockAdapter).href)}`,
  '',
  '- id: agent-default-model',
  '  config:',
  '    provider: mock',
  '    model: mock',
  '',
].join('\n')

const out = resolve(process.argv[2] ?? join(tmpdir(), `dsh-code-mock-${process.pid}.cordis.yml`))
writeFileSync(out, overlay)
console.log(out)
