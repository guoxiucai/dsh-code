import { describe, expect, it } from 'vitest'
import { webParkedText } from '../../src/cli/web-parked-host.ts'

describe('Web parked terminal copy', () => {
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
