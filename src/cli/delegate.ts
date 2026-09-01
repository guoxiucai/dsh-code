/**
 * Launcher delegation. dsh-code does not reimplement DSH boot/shutdown/plugin
 * reconciliation: it resolves the upstream `@deepseek-ai/dsh` bin and spawns it
 * with the current Node executable, inheriting stdio and the process exit code.
 * @module dsh-code/cli/delegate
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  isSessionDiscardMessage,
  isSessionSwitchMessage,
  type SessionSwitchTarget,
} from '../session-switch.ts'

const require = createRequire(import.meta.url)

/**
 * Resolve the upstream dsh launcher entry (`@deepseek-ai/dsh/lib/bin.js`) from
 * the installed dependencies. Resolving `package.json` (not an export) keeps
 * this robust whether or not the package later gains an `exports` map.
 */
export function resolveDshBin(): string {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

/**
 * Spawn the upstream launcher with the current Node executable, inheriting
 * stdio, and settle with the child's exit code (or a failure code when it
 * cannot be spawned at all).
 * @param dshArgs - argv for the upstream launcher (e.g. `['--profile', 'dsh-code']`).
 * @param env - process environment for the child (home isolation applied here).
 */
export function delegateDsh(dshArgs: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    let bin: string
    try {
      bin = resolveDshBin()
    } catch (error) {
      process.stderr.write(`dsh-code: cannot resolve @deepseek-ai/dsh: ${error instanceof Error ? error.message : String(error)}\n`)
      resolve(1)
      return
    }
    const child = spawn(process.execPath, [bin, ...dshArgs], { stdio: 'inherit', env })
    child.on('error', (error) => {
      process.stderr.write(`dsh-code: failed to launch dsh: ${error.message}\n`)
      resolve(1)
    })
    child.on('exit', (code, signal) => {
      if (signal !== null) resolve(signal === 'SIGINT' ? 130 : 1)
      else resolve(code ?? 1)
    })
  })
}

export interface WebDelegateOptions {
  env: NodeJS.ProcessEnv
  /** Trusted launcher patch layers that are valid over the upstream Web profile. */
  patchArgs?: readonly string[]
  /** Called once after the upstream Web profile prints its readiness URL. */
  onReady?(url: string): void
  /** Receives bounded, non-readiness output for a suspended terminal status. */
  onDiagnostic?(line: string): void
}

export interface WebDelegateResult {
  code: number
  readyUrl?: string
  stopRequested: boolean
  diagnostics: readonly string[]
}

export interface WebDelegateHandle {
  result: Promise<WebDelegateResult>
  /** Request upstream's ordinary signal-driven shutdown; settlement waits for exit. */
  stop(): void
}

/** Fixed upstream invocation owned by the Web-surface adapter. */
export function webDshArgs(patchArgs: readonly string[] = []): string[] {
  return ['--profile', 'web', ...patchArgs, '--port', '0']
}

/** Extract the authenticated local readiness URL from upstream's supervisor line. */
export function parseWebReadyLine(line: string): string | undefined {
  return line.trim().match(/^dsh web:\s+(https?:\/\/\S+)/u)?.[1]
}

/**
 * Launch dsh-code's package-local upstream Web profile. The handle hides
 * process signals, line framing, readiness parsing, and diagnostic buffering.
 */
export function delegateDshWeb(options: WebDelegateOptions): WebDelegateHandle {
  let bin: string
  try {
    bin = resolveDshBin()
  } catch (error) {
    const diagnostic = `cannot resolve @deepseek-ai/dsh: ${error instanceof Error ? error.message : String(error)}`
    return {
      result: Promise.resolve({ code: 1, stopRequested: false, diagnostics: [diagnostic] }),
      stop: () => {},
    }
  }
  return delegateWebProcess(bin, webDshArgs(options.patchArgs), options)
}

/** @internal Process seam exported for Web-supervisor integration tests. */
export function delegateWebProcess(
  bin: string,
  dshArgs: readonly string[],
  options: Omit<WebDelegateOptions, 'patchArgs'>,
): WebDelegateHandle {
  let child: ChildProcess | undefined
  let stopRequested = false
  let settled = false
  let readyUrl: string | undefined
  const diagnostics: string[] = []
  const MAX_DIAGNOSTICS = 20
  let settleResult: ((result: WebDelegateResult) => void) | undefined
  const result = new Promise<WebDelegateResult>((resolve) => { settleResult = resolve })

  const settle = (code: number): void => {
    if (settled) return
    settled = true
    settleResult?.({
      code,
      ...(readyUrl === undefined ? {} : { readyUrl }),
      stopRequested,
      diagnostics: [...diagnostics],
    })
  }
  const report = (line: string): void => {
    const normalized = line.trim()
    if (normalized === '') return
    const parsed = parseWebReadyLine(normalized)
    if (parsed !== undefined) {
      if (readyUrl === undefined) {
        readyUrl = parsed
        options.onReady?.(parsed)
      }
      return
    }
    diagnostics.push(normalized)
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift()
    options.onDiagnostic?.(normalized)
  }
  const readLines = (stream: NodeJS.ReadableStream | null): void => {
    if (stream === null) return
    let buffered = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      buffered += chunk
      const lines = buffered.split(/\r?\n/u)
      buffered = lines.pop() ?? ''
      for (const line of lines) report(line)
    })
    stream.on('end', () => { if (buffered !== '') report(buffered) })
  }

  try {
    child = spawn(process.execPath, [bin, ...dshArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env,
    })
    readLines(child.stdout)
    readLines(child.stderr)
    child.on('error', (error) => {
      report(`failed to launch dsh web: ${error.message}`)
      settle(1)
    })
    child.on('exit', (code, signal) => {
      settle(signal === null ? (code ?? 1) : (signal === 'SIGINT' || stopRequested ? 130 : 1))
    })
  } catch (error) {
    report(`failed to launch dsh web: ${error instanceof Error ? error.message : String(error)}`)
    settle(1)
  }

  return {
    result,
    stop: () => {
      if (settled || stopRequested) return
      stopRequested = true
      child?.kill('SIGINT')
    },
  }
}

export interface InteractiveDelegateResult {
  code: number
  switchTarget?: SessionSwitchTarget
  discardSessionId?: string
}

/**
 * Spawn an interactive DSH child with one private IPC channel. A validated
 * switch request is returned only after the old child has completely exited.
 */
export function delegateDshInteractive(
  dshArgs: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<InteractiveDelegateResult> {
  let bin: string
  try {
    bin = resolveDshBin()
  } catch (error) {
    process.stderr.write(`dsh-code: cannot resolve @deepseek-ai/dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    return Promise.resolve({ code: 1 })
  }
  return delegateInteractiveProcess(bin, dshArgs, env)
}

/** @internal Process seam exported for the launcher's IPC integration tests. */
export function delegateInteractiveProcess(
  bin: string,
  dshArgs: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<InteractiveDelegateResult> {
  return new Promise((resolve) => {
    let switchTarget: SessionSwitchTarget | undefined
    let discardSessionId: string | undefined
    let settled = false
    const settle = (result: InteractiveDelegateResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn(process.execPath, [bin, ...dshArgs], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env,
    })
    child.on('message', (message) => {
      if (switchTarget === undefined && isSessionSwitchMessage(message)) {
        switchTarget = message.target
      }
      if (discardSessionId === undefined && isSessionDiscardMessage(message)) {
        discardSessionId = message.sessionId
      }
    })
    child.on('error', (error) => {
      process.stderr.write(`dsh-code: failed to launch dsh: ${error.message}\n`)
      settle({ code: 1 })
    })
    child.on('exit', (code, signal) => {
      const resultCode = signal !== null ? (signal === 'SIGINT' ? 130 : 1) : (code ?? 1)
      settle({
        code: resultCode,
        ...(resultCode !== 0 || switchTarget === undefined ? {} : { switchTarget }),
        ...(resultCode !== 0 || discardSessionId === undefined ? {} : { discardSessionId }),
      })
    })
  })
}
