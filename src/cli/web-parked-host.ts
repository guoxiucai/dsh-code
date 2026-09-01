/**
 * Read-only terminal surface shown while the package-local upstream Web app
 * owns interaction. It deliberately exposes lifecycle keys only, never an
 * editor or Agent command path.
 * @module dsh-code/cli/web-parked-host
 */

import {
  Container,
  Key,
  ProcessTerminal,
  Text,
  TuiAltScreen,
  isKeyRelease,
  matchesKey,
} from '@earendil-works/pi-tui'
import { theme } from '../tui/theme.ts'

export interface WebParkedState {
  phase: 'starting' | 'ready' | 'stopping'
  url?: string
  diagnostic?: string
}

/** Plain semantic copy kept separate from terminal mechanics for stable tests. */
export function webParkedText(state: WebParkedState): string {
  const status = state.phase === 'starting'
    ? '正在启动 dsh-code Web…'
    : state.phase === 'stopping'
      ? '正在停止 Web，等待会话安全落盘…'
      : '已切换到 dsh-code Web'
  return [
    'dsh-code Web',
    '',
    status,
    ...(state.url === undefined ? [] : ['', `地址：${state.url}`]),
    ...(state.diagnostic === undefined ? [] : ['', `状态：${state.diagnostic}`]),
    '',
    'TUI 对话已暂停，当前会话只由 Web 写入。',
    '关闭浏览器标签不会停止 Web 服务。',
    '',
    'Esc      停止 Web 并返回 TUI',
    'Ctrl+D   停止 Web 并退出 dsh-code',
  ].join('\n')
}

export interface WebParkedHostCallbacks {
  onReturn(): void
  onExit(): void
}

/** Alternate-screen lifecycle shell owned by the dsh-code launcher. */
export class WebParkedHost {
  readonly tui: TuiAltScreen
  private readonly body: Text
  private readonly detachInput: () => void
  private state: WebParkedState = { phase: 'starting' }
  private started = false

  constructor(private readonly callbacks: WebParkedHostCallbacks) {
    this.tui = new TuiAltScreen(new ProcessTerminal())
    this.body = new Text('', 2, 1)
    const root = new Container()
    root.addChild(this.body)
    this.tui.setLayoutRoot(root)
    this.detachInput = this.tui.addInputListener(data => this.handleInput(data))
    this.render()
  }

  private handleInput(data: string): { consume: true } {
    if (!isKeyRelease(data)) {
      if (matchesKey(data, 'escape')) this.callbacks.onReturn()
      else if (matchesKey(data, Key.ctrl('d')) || matchesKey(data, Key.ctrl('c'))) this.callbacks.onExit()
      else if (matchesKey(data, Key.ctrl('l'))) {
        this.tui.invalidate()
        this.tui.requestRender(true)
      }
    }
    return { consume: true }
  }

  ready(url: string): void {
    this.state = { ...this.state, phase: 'ready', url }
    this.render()
  }

  diagnostic(line: string): void {
    this.state = { ...this.state, diagnostic: line }
    this.render()
  }

  stopping(): void {
    this.state = { ...this.state, phase: 'stopping' }
    this.render()
  }

  private render(): void {
    const text = webParkedText(this.state)
      .replace(/^dsh-code Web$/mu, theme.accent(theme.bold('dsh-code Web')))
    this.body.setText(text)
    this.tui.requestRender()
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.tui.start()
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.detachInput()
    this.tui.stop()
  }
}
