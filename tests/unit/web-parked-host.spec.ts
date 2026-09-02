import { describe, expect, it, vi } from 'vitest'
import { WebParkedHost, webParkedText } from '../../src/cli/web-parked-host.ts'

describe('Web parked terminal copy', () => {
  it('restores the main buffer without printing the parked surface', () => {
    const host = new WebParkedHost({ onReturn: () => {}, onExit: () => {} })
    vi.spyOn(host.tui, 'start').mockImplementation(() => {})
    const stop = vi.spyOn(host.tui, 'stop').mockImplementation(() => {})

    host.start()
    host.stop()

    expect(stop).toHaveBeenCalledWith({ preserveScreen: true })
  })

  it('keeps the TUI explicitly read-only and explains browser/process lifetime', () => {
    const text = webParkedText({
      phase: 'ready',
      url: 'http://127.0.0.1:3080/?token=test',
    })

    expect(text).toContain('已切换到 dsh-code Web')
    expect(text).toContain('http://127.0.0.1:3080/?token=test')
    expect(text).toContain('TUI 对话已暂停')
    expect(text).toContain('关闭浏览器标签不会停止 Web 服务')
    expect(text).toContain('Esc      停止 Web 并返回 TUI')
    expect(text).not.toContain('Enter')
  })

  it('shows the durable-drain phase before returning to the TUI', () => {
    expect(webParkedText({ phase: 'stopping' })).toContain('等待会话安全落盘')
  })
})
