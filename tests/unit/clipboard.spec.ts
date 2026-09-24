import { describe, expect, it } from 'vitest'
import { clipboardInvocation, clipboardReadInvocation, readClipboard, writeClipboard } from '../../src/tui/clipboard.ts'

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

  it('prefers the first available Linux tool and passes text via stdin', () => {
    expect(clipboardInvocation('中文\nselection', 'linux', name => name === 'xclip')).toEqual({
      command: 'xclip',
      args: ['-selection', 'clipboard'],
      input: '中文\nselection',
    })
    expect(clipboardInvocation('selection', 'linux', name => name === 'xsel')?.command).toBe('xsel')
    expect(clipboardInvocation('selection', 'linux', name => name === 'wl-copy')).toEqual({
      command: 'wl-copy',
      args: [],
      input: 'selection',
    })
  })

  it('falls back to OSC 52 (no bridge) when no Linux tool is installed', async () => {
    const none = (): boolean => false
    expect(clipboardInvocation('selection', 'linux', none)).toBeUndefined()
    await expect(writeClipboard('selection', 'linux', none)).resolves.toBe(false)
  })

  it('prefers the first available Linux read tool', () => {
    expect(clipboardReadInvocation('linux', name => name === 'xclip')).toEqual({
      command: 'xclip',
      args: ['-selection', 'clipboard', '-o'],
    })
    expect(clipboardReadInvocation('linux', name => name === 'xsel')?.command).toBe('xsel')
    expect(clipboardReadInvocation('linux', name => name === 'wl-paste')).toEqual({
      command: 'wl-paste',
      args: [],
    })
    expect(clipboardReadInvocation('darwin')).toEqual({ command: 'pbpaste', args: [] })
  })

  it('resolves undefined when no Linux read tool is installed', async () => {
    await expect(readClipboard('linux', () => false)).resolves.toBeUndefined()
  })
})
