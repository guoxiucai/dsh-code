/**
 * Native clipboard bridge for pi-tui's application-owned transcript selection.
 * @module dsh-code/tui/clipboard
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface ClipboardInvocation {
  command: string
  args: string[]
  input: string
}

const WINDOWS_CLIPBOARD_SCRIPT = [
  '$encoded = [Console]::In.ReadToEnd()',
  '$bytes = [Convert]::FromBase64String($encoded)',
  'Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString($bytes))',
].join('; ')

/**
 * Linux clipboard commands in preference order: X11 `xclip`/`xsel` first (the
 * common desktop default), then Wayland `wl-copy`. Each reads UTF-8 text from
 * stdin, matching the process-spawn contract of the other platforms.
 */
const LINUX_CLIPBOARD_COMMANDS: ReadonlyArray<{ command: string, args: string[] }> = [
  { command: 'xclip', args: ['-selection', 'clipboard'] },
  { command: 'xsel', args: ['--clipboard', '--input'] },
  { command: 'wl-copy', args: [] },
]

/** Linux clipboard read commands, mirroring the write preference order. */
const LINUX_CLIPBOARD_READ_COMMANDS: ReadonlyArray<{ command: string, args: string[] }> = [
  { command: 'xclip', args: ['-selection', 'clipboard', '-o'] },
  { command: 'xsel', args: ['--clipboard', '--output'] },
  { command: 'wl-paste', args: [] },
]

/** True when `name` resolves to an executable on `path`, without invoking a shell. */
export function commandExists(name: string, path = process.env.PATH ?? ''): boolean {
  if (name.length === 0 || name.includes('/')) return false
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue
    try {
      accessSync(join(dir, name), constants.X_OK)
      return true
    } catch {
      // Keep scanning the remaining PATH entries.
    }
  }
  return false
}

/**
 * Resolve a shell-free native clipboard process for a supported platform.
 * `hasCommand` is injectable so Linux tool preference can be tested without the
 * test host having any of the tools installed.
 */
export function clipboardInvocation(
  text: string,
  platform = process.platform,
  hasCommand: (name: string) => boolean = commandExists,
): ClipboardInvocation | undefined {
  if (platform === 'darwin') return { command: 'pbcopy', args: [], input: text }
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_CLIPBOARD_SCRIPT],
      input: Buffer.from(text, 'utf8').toString('base64'),
    }
  }
  if (platform === 'linux') {
    for (const tool of LINUX_CLIPBOARD_COMMANDS) {
      if (hasCommand(tool.command)) return { command: tool.command, args: [...tool.args], input: text }
    }
    // No tool installed: let the host keep pi-tui's OSC 52 fallback.
    return undefined
  }
  return undefined
}

/** Write exact Unicode text to the native system clipboard. */
export function writeClipboard(
  text: string,
  platform = process.platform,
  hasCommand: (name: string) => boolean = commandExists,
): Promise<boolean> {
  const invocation = clipboardInvocation(text, platform, hasCommand)
  if (invocation === undefined) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const settle = (result: boolean): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    let child: ChildProcess
    try {
      child = spawn(invocation.command, invocation.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
        timeout: 2000,
      })
    } catch {
      settle(false)
      return
    }
    child.once('error', () => { settle(false) })
    child.once('close', code => { settle(code === 0) })
    if (child.stdin === null) {
      settle(false)
      return
    }
    child.stdin.once('error', () => { settle(false) })
    child.stdin.end(invocation.input)
  })
}

/** Resolve a shell-free native clipboard read process for a supported platform. */
export function clipboardReadInvocation(
  platform = process.platform,
  hasCommand: (name: string) => boolean = commandExists,
): { command: string, args: string[] } | undefined {
  if (platform === 'darwin') return { command: 'pbpaste', args: [] }
  if (platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'] }
  }
  if (platform === 'linux') {
    for (const tool of LINUX_CLIPBOARD_READ_COMMANDS) {
      if (hasCommand(tool.command)) return { command: tool.command, args: [...tool.args] }
    }
    return undefined
  }
  return undefined
}

/** Read the native system clipboard as UTF-8 text, or `undefined` when unavailable. */
export function readClipboard(
  platform = process.platform,
  hasCommand: (name: string) => boolean = commandExists,
): Promise<string | undefined> {
  const invocation = clipboardReadInvocation(platform, hasCommand)
  if (invocation === undefined) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    let settled = false
    const settle = (value: string | undefined): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let output = ''
    let child: ChildProcess
    try {
      child = spawn(invocation.command, invocation.args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 2000,
      })
    } catch {
      settle(undefined)
      return
    }
    child.once('error', () => { settle(undefined) })
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.once('close', code => { settle(code === 0 ? output : undefined) })
  })
}
