/**
 * Native clipboard bridge for pi-tui's application-owned transcript selection.
 * @module dsh-code/tui/clipboard
 */

import { spawn, type ChildProcess } from 'node:child_process'

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

/** Resolve a shell-free native clipboard process for a supported platform. */
export function clipboardInvocation(text: string, platform = process.platform): ClipboardInvocation | undefined {
  if (platform === 'darwin') return { command: 'pbcopy', args: [], input: text }
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_CLIPBOARD_SCRIPT],
      input: Buffer.from(text, 'utf8').toString('base64'),
    }
  }
  return undefined
}

/** Write exact Unicode text to the macOS or Windows system clipboard. */
export function writeClipboard(text: string, platform = process.platform): Promise<boolean> {
  const invocation = clipboardInvocation(text, platform)
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
