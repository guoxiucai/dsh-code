#!/usr/bin/env node
/**
 * Transparent MCP stdio proxy. Protocol stdin/stdout stay byte-for-byte pipes;
 * noisy server stderr goes to a private file (or is discarded) so it can never
 * write directly into pi-tui's alternate screen.
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { spawn as nodeSpawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const spawn = require('cross-spawn') as typeof nodeSpawn
const STDERR_LOG_ENV = 'DSH_CODE_MCP_STDERR_LOG'
const MAX_LOG_BYTES = 1024 * 1024

function stderrTarget(path: string | undefined): { target: number | 'ignore'; close(): void } {
  if (path === undefined || path === '') return { target: 'ignore', close() {} }
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (existsSync(path) && statSync(path).size >= MAX_LOG_BYTES) {
      const previous = `${path}.1`
      if (existsSync(previous)) unlinkSync(previous)
      renameSync(path, previous)
    }
    const fd = openSync(path, 'a', 0o600)
    return { target: fd, close: () => { closeSync(fd) } }
  } catch {
    return { target: 'ignore', close() {} }
  }
}

function recordProxyError(path: string | undefined, error: unknown): void {
  if (path === undefined || path === '') return
  try { appendFileSync(path, `[dsh-code proxy] ${error instanceof Error ? error.message : String(error)}\n`, { mode: 0o600 }) } catch {}
}

const [command, ...args] = process.argv.slice(2)
if (command === undefined || command === '') process.exit(1)

const logPath = process.env[STDERR_LOG_ENV]
const childEnv = { ...process.env }
delete childEnv[STDERR_LOG_ENV]
const stderr = stderrTarget(logPath)
let child
try {
  child = spawn(command, args, {
    cwd: process.cwd(),
    env: childEnv,
    windowsHide: true,
    stdio: ['pipe', 'pipe', stderr.target],
  })
} catch (error) {
  stderr.close()
  recordProxyError(logPath, error)
  process.exit(1)
}
stderr.close()

process.stdin.pipe(child.stdin!)
child.stdout!.pipe(process.stdout)
child.stdin?.on('error', () => {})
child.stdout?.on('error', () => {})
process.stdout.on('error', () => { if (!child.killed) child.kill() })

let forceTimer: ReturnType<typeof setTimeout> | undefined
child.on('error', (error) => {
  recordProxyError(logPath, error)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  if (forceTimer !== undefined) clearTimeout(forceTimer)
  process.exitCode = code ?? (signal === null ? 0 : 1)
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (!child.killed) {
      try { child.kill(signal) } catch { child.kill() }
      forceTimer ??= setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 1500)
    }
  })
}

process.on('exit', () => {
  if (forceTimer !== undefined) clearTimeout(forceTimer)
  if (!child.killed) child.kill()
})
