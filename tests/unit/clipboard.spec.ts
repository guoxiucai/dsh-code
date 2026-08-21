import { describe, expect, it } from 'vitest'
import { clipboardInvocation, writeClipboard } from '../../src/tui/clipboard.ts'

describe('native clipboard bridge', () => {
  it('uses pbcopy directly on macOS', () => {
    expect(clipboardInvocation('中文\nselection', 'darwin')).toEqual({
      command: 'pbcopy',
      args: [],
      input: '中文\nselection',
    })
  })

  it('passes exact Unicode text to Windows PowerShell without command interpolation', () => {
    const text = '中文 "quoted"\n$(not executed)'
    const invocation = clipboardInvocation(text, 'win32')

    expect(invocation?.command).toBe('powershell.exe')
    expect(invocation?.args).toContain('-NoProfile')
    expect(invocation?.args.join(' ')).toContain('Set-Clipboard')
    expect(Buffer.from(invocation?.input ?? '', 'base64').toString('utf8')).toBe(text)
    expect(invocation?.args.join(' ')).not.toContain(text)
  })

  it('reports when no native bridge is available so the host can retain the OSC 52 fallback', async () => {
    expect(clipboardInvocation('selection', 'linux')).toBeUndefined()
    await expect(writeClipboard('selection', 'linux')).resolves.toBe(false)
  })
})
