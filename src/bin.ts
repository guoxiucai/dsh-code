#!/usr/bin/env node
/**
 * dsh-code — command-line entry. Owns product verbs, home isolation, project
 * trust, profile initialization, and delegation to the upstream `dsh`
 * launcher. All agent semantics come from the pinned upstream DSH.
 * @module dsh-code/bin
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HELP_TEXT, parseArgs, type PromptInvocation, type TuiInvocation } from './cli/args.ts'
import { delegateDsh } from './cli/delegate.ts'
import { unsupportedPlatformMessage } from './cli/platform.ts'
import { runUpdate } from './cli/update.ts'
import { resolveDshCodeHome } from './bootstrap/home.ts'
import { FIRST_MODEL_CONFIG_ENV, hasStoredCredential } from './bootstrap/credentials.ts'
import { initDshCodeProfile } from './bootstrap/profile.ts'
import { listProjectSessions } from './bootstrap/sessions.ts'
import {
  canonicalizeProjectPath,
  isProjectTrusted,
  writeTrustRecord,
} from './bootstrap/trust.ts'

/** This product's version, read from its checked-in package.json (never the network). */
function readVersion(): string {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/** Absolute `file://` module URL of the built TUI plugin, beside this bin. */
function tuiPluginUrl(): string {
  return new URL('./tui/plugin.js', import.meta.url).href
}

/** Child-process environment with home isolation and telemetry disabled. */
function delegatedEnv(home: string, firstModelConfig = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
  }
  // Never inherit a stale/spoofed onboarding signal from the parent shell.
  delete env[FIRST_MODEL_CONFIG_ENV]
  if (firstModelConfig) env[FIRST_MODEL_CONFIG_ENV] = '1'
  return env
}

/** Interactive first-trust for the TTY surfaces; non-TTY prompt needs `--approve`. */
async function ensureTrusted(home: string, canonical: string, approve: boolean): Promise<number | undefined> {
  if (isProjectTrusted(home, canonical)) return undefined
  const tty = process.stdin.isTTY === true && process.stdout.isTTY === true
  if (tty) {
    const { pickTrust } = await import('./bootstrap/trust-picker.ts')
    const answer = await pickTrust(canonical)
    if (answer.kind === 'reject') {
      process.stderr.write('dsh-code: project not trusted; not loading project configuration\n')
      return 1
    }
    writeTrustRecord(home, canonical, answer.preset)
    return undefined
  }
  if (approve) {
    writeTrustRecord(home, canonical, 'workspace-write')
    return undefined
  }
  process.stderr.write(`dsh-code: project ${canonical} is not trusted; re-run with --approve to accept startup trust\n`)
  return 1
}

/**
 * Launcher `--patch` args for the trusted project's own `.dsh-code/cordis.patch.yml`
 * (MCP servers, project plugins). Empty when the file is absent. Only reached
 * after the trust gate, so an untrusted project's patch is never loaded.
 */
function projectPatchArgs(): string[] {
  const patch = join(process.cwd(), '.dsh-code', 'cordis.patch.yml')
  return existsSync(patch) ? ['--patch', patch] : []
}

/** Boot the interactive TUI profile. */
async function runTui(invocation: TuiInvocation): Promise<number> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write('dsh-code: the interactive UI needs a TTY; use `dsh-code -p "<task>"` for non-interactive use\n')
    return 1
  }
  const home = resolveDshCodeHome()
  const canonical = canonicalizeProjectPath()
  const rejected = await ensureTrusted(home, canonical, false)
  if (rejected !== undefined) return rejected
  initDshCodeProfile(home, tuiPluginUrl(), canonical)
  let appArgs: string[]
  if (invocation.resume !== undefined) {
    appArgs = ['--resume', invocation.resume]
  } else if (invocation.continueLatest === true) {
    // `-c`/`--continue`: resume the most recent session for this project, or
    // start fresh when there is no history.
    const latest = listProjectSessions(home, canonical)[0]
    appArgs = latest === undefined ? [] : ['--resume', latest.id]
  } else if (invocation.resumePicker === true) {
    // `-r`/`--resume`: pick a session from the full-screen picker. Esc exits
    // without resuming; the picker never falls through to a fresh session.
    const { pickSession } = await import('./bootstrap/resume-picker.ts')
    const picked = await pickSession(home, canonical)
    if (picked.kind === 'exit') return 0
    appArgs = ['--resume', picked.id]
  } else {
    appArgs = []
  }
  const firstModelConfig = !hasStoredCredential(home)
  return delegateDsh(
    ['--profile', 'dsh-code', ...projectPatchArgs(), ...appArgs],
    delegatedEnv(home, firstModelConfig),
  )
}

/** Run one task through the upstream headless profile. */
async function runPrompt(invocation: PromptInvocation): Promise<number> {
  const home = resolveDshCodeHome()
  const canonical = canonicalizeProjectPath()
  const rejected = await ensureTrusted(home, canonical, invocation.approve)
  if (rejected !== undefined) return rejected
  // The upstream headless profile prints only the final assistant text on
  // stdout and reports a non-zero exit for a failed/cancelled/errored task.
  return delegateDsh(['--profile', 'headless', ...projectPatchArgs(), invocation.prompt], delegatedEnv(home))
}

/** Forward plugin management to the upstream `dsh plugin` subcommand (pnpm). */
async function runPlugin(args: readonly string[]): Promise<number> {
  const home = resolveDshCodeHome()
  initDshCodeProfile(home, tuiPluginUrl())
  return delegateDsh(['plugin', '--profile', 'dsh-code', ...args], delegatedEnv(home))
}

/** Not-yet-implemented product verb: report cleanly rather than silently no-op. */
function notImplemented(verb: string): number {
  process.stderr.write(`dsh-code: \`${verb}\` is not implemented in this build\n`)
  return 1
}

/** Entry point; resolves to the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const invocation = parseArgs(argv)
  if (invocation.mode !== 'help' && invocation.mode !== 'version' && invocation.mode !== 'error') {
    const unsupported = unsupportedPlatformMessage()
    if (unsupported !== undefined) {
      process.stderr.write(`dsh-code: ${unsupported}\n`)
      return 1
    }
  }
  switch (invocation.mode) {
    case 'version':
      process.stdout.write(`${readVersion()}\n`)
      return 0
    case 'help':
      process.stdout.write(HELP_TEXT)
      return 0
    case 'error':
      process.stderr.write(`dsh-code: ${invocation.message}\n`)
      return 2
    case 'tui':
      return runTui(invocation)
    case 'prompt':
      return runPrompt(invocation)
    case 'plugin':
      return runPlugin(invocation.args)
    case 'config':
      return notImplemented('config')
    case 'import-dsh':
      return notImplemented('import dsh')
    case 'update':
      return runUpdate(invocation)
  }
}

/** True when this module is the process entry (not imported by a test). */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  // Resolve the entry through realpath so a symlinked `dsh-code` bin (npm link,
  // a PATH symlink) still matches this module's real file URL.
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  }
}

// Self-executing dispatch: never import this module for side effects.
/* v8 ignore next -- bin dispatch is exercised via the built artifact */
if (isEntryPoint()) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code })
}
