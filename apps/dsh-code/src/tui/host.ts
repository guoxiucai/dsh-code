/**
 * Terminal host: the pi-tui `TuiMainScreen` surface plus the transcript, status,
 * and editor components. It owns terminal lifecycle (raw mode, restore on
 * stop) but no agent semantics — those come from the plugin via callbacks.
 * @module dsh-code/tui/host
 */

import {
  Container,
  Editor,
  Key,
  ProcessTerminal,
  SelectList,
  Spacer,
  Text,
  TuiMainScreen,
  matchesKey,
  type EditorTheme,
  type TUI,
} from '@earendil-works/pi-tui'
import type { TranscriptItem, TuiViewModel } from './view-model.ts'

/** Identity theme: no color until a themed palette is added (readable without color). */
const EDITOR_THEME: EditorTheme = {
  borderColor: str => str,
  selectList: {
    selectedPrefix: str => str,
    selectedText: str => str,
    description: str => str,
    scrollInfo: str => str,
    noMatch: str => str,
  },
}

/** Callbacks the host forwards to the plugin. */
export interface TuiHostCallbacks {
  onSubmit(text: string): void
  onCancel(): void
  onExit(): void
  onRedraw(): void
}

/** In-flight assistant stream (text + reasoning merged from `assistant/chunk`). */
export interface AssistantDraft {
  text: string
  reasoning: string
}

/** Render a transcript row to one display line (no leading/trailing whitespace). */
export function renderTranscriptItem(item: TranscriptItem): string {
  switch (item.kind) {
    case 'user': return `> ${item.text}`
    case 'assistant': return item.reasoning !== undefined && item.reasoning !== ''
      ? `${item.text}\n  (reasoning) ${item.reasoning}`
      : item.text
    case 'tool': {
      const result = item.status === 'running' ? ''
        : item.status === 'error' ? ` — error${item.errorCode !== undefined ? ` (${item.errorCode})` : ''}`
          : item.resultText !== undefined && item.resultText !== '' ? ` — ${item.resultText}`
            : ''
      return `⚙ ${item.name}${item.arguments !== '' ? ` ${item.arguments}` : ''}${result}`
    }
    case 'notice': return `· ${item.text}`
  }
}

/** Assemble the full transcript text (committed items plus the live draft). */
export function renderTranscript(items: readonly TranscriptItem[], draft?: AssistantDraft): string {
  const lines = items.map(renderTranscriptItem)
  if (draft !== undefined && (draft.text !== '' || draft.reasoning !== '')) {
    lines.push(draft.text)
  }
  return lines.filter(line => line !== '').join('\n')
}

/** Assemble the status line. */
export function renderStatus(view: TuiViewModel, model?: { provider: string; model: string }): string {
  const parts: string[] = []
  if (model !== undefined) parts.push(`${model.provider}/${model.model}`)
  parts.push(view.phase)
  if (view.tokenUsage !== undefined) {
    parts.push(`↑${view.tokenUsage.inputTokens} ↓${view.tokenUsage.outputTokens}`)
  }
  if (view.todos.length > 0) {
    const done = view.todos.filter(todo => todo.status === 'completed').length
    parts.push(`todo ${done}/${view.todos.length}`)
  }
  return parts.join(' · ')
}

/**
 * Owns the pi-tui surface. Terminal restoration is `stop()`'s job; the plugin
 * must guarantee `stop()` runs on every exit path (see ADR-001).
 */
export class TuiHost {
  readonly tui: TUI
  private readonly transcript: Text
  private readonly status: Text
  private readonly editor: Editor
  private readonly callbacks: TuiHostCallbacks
  private readonly detachInput: () => void
  private draft: AssistantDraft | undefined
  private model: { provider: string; model: string } | undefined

  constructor(callbacks: TuiHostCallbacks) {
    this.callbacks = callbacks
    this.tui = new TuiMainScreen(new ProcessTerminal())
    this.transcript = new Text('', 1, 0)
    this.status = new Text('', 1, 0)
    this.editor = new Editor(this.tui, EDITOR_THEME, { paddingX: 1 })
    this.editor.onSubmit = (text) => { this.callbacks.onSubmit(text) }

    const root = new Container()
    root.addChild(this.transcript)
    root.addChild(this.status)
    root.addChild(new Spacer())
    root.addChild(this.editor)
    this.tui.addChild(root)
    this.tui.setFocus(this.editor)
    this.detachInput = this.tui.addInputListener(data => this.handleInput(data))
  }

  private handleInput(data: string): { consume: true } | undefined {
    if (matchesKey(data, Key.ctrl('c'))) { this.callbacks.onCancel(); return { consume: true } }
    if (matchesKey(data, Key.ctrl('d'))) { this.callbacks.onExit(); return { consume: true } }
    if (matchesKey(data, Key.ctrl('l'))) { this.callbacks.onRedraw(); return { consume: true } }
    return undefined
  }

  /** Update the rendered transcript/status from the reduced view model. */
  render(view: TuiViewModel): void {
    this.transcript.setText(renderTranscript(view.transcript, this.draft))
    this.status.setText(renderStatus(view, this.model))
    this.tui.requestRender()
  }

  /** Update only the live streaming draft (throttled by the caller). */
  setDraft(draft: AssistantDraft | undefined): void {
    this.draft = draft
  }

  /** Pin the model provenance shown in the status line. */
  setModel(model: { provider: string; model: string }): void {
    this.model = model
  }

  getText(): string { return this.editor.getText() }
  setText(text: string): void { this.editor.setText(text) }
  clearEditor(): void { this.editor.setText('') }
  addHistory(text: string): void { this.editor.addToHistory(text) }
  setSubmitDisabled(disabled: boolean): void { this.editor.disableSubmit = disabled }

  /**
   * Show a modal question overlay (a title plus a selectable choice list) and
   * resolve the chosen value, or `undefined` when cancelled. Restores editor
   * focus when the overlay closes.
   */
  askChoice(question: string, choices: readonly { value: string; label: string }[]): Promise<string | undefined> {
    return new Promise((resolve) => {
      const box = new Container()
      box.addChild(new Text(question, 1, 1))
      const list = new SelectList(
        choices.map(choice => ({ value: choice.value, label: choice.label })),
        Math.min(choices.length, 8),
        EDITOR_THEME.selectList,
      )
      box.addChild(list)
      const handle = this.tui.showOverlay(box)
      let settled = false
      const settle = (value: string | undefined): void => {
        if (settled) return
        settled = true
        handle.hide()
        this.tui.setFocus(this.editor)
        resolve(value)
      }
      list.onSelect = (item) => { settle(item.value) }
      list.onCancel = () => { settle(undefined) }
      this.tui.setFocus(list)
    })
  }

  start(): void { this.tui.start() }
  stop(): void { this.detachInput(); this.tui.stop() }
}
