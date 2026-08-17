/**
 * Terminal host: the pi-tui `TuiMainScreen` surface plus the transcript, status,
 * and editor components. It owns terminal lifecycle (raw mode, restore on
 * stop) but no agent semantics — those come from the plugin via callbacks.
 * @module dsh-code/tui/host
 */

import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Key,
  Loader,
  Markdown,
  ProcessTerminal,
  SelectList,
  Spacer,
  Text,
  TuiMainScreen,
  matchesKey,
  type Component,
  type EditorTheme,
  type MarkdownTheme,
  type OverlayHandle,
  type SlashCommand,
  type TUI,
} from '@earendil-works/pi-tui'
import { theme } from './theme.ts'
import type { ToolDiff, TranscriptItem, TuiViewModel } from './view-model.ts'
import { diffLines } from 'diff'

/** Editor + autocomplete theme: purple input border, highlighted selection. */
const EDITOR_THEME: EditorTheme = {
  borderColor: theme.border,
  selectList: {
    selectedPrefix: theme.accent,
    selectedText: text => theme.selected(theme.accent(text)),
    description: theme.dim,
    scrollInfo: theme.dim,
    noMatch: theme.warning,
  },
}

/** Markdown rendering theme for assistant output. */
const MARKDOWN_THEME: MarkdownTheme = {
  heading: theme.accent,
  link: theme.accent,
  linkUrl: theme.dim,
  code: theme.code,
  codeBlock: theme.code,
  codeBlockBorder: theme.dim,
  quote: theme.dim,
  quoteBorder: theme.dim,
  hr: theme.dim,
  listBullet: theme.accent,
  bold: theme.bold,
  italic: theme.italic,
  strikethrough: theme.dim,
  underline: theme.dim,
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

/** Max result lines shown while a tool card is collapsed. */
const MAX_TOOL_OUTPUT_LINES = 5

/** Format a millisecond duration for a timing footer. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Extract a readable command/path from a tool call's raw JSON arguments. */
function toolArgumentSummary(rawArguments: string): string {
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>
    if (typeof parsed.command === 'string') return parsed.command
    if (typeof parsed.path === 'string') return parsed.path
  } catch {
    // Fall through to the raw string.
  }
  return rawArguments
}

/** Render a write/edit tool's file diffs as colored +/− lines. */
function renderDiff(diffs: readonly ToolDiff[]): string[] {
  const lines: string[] = []
  for (const diff of diffs) {
    lines.push(theme.dim(`  ${diff.path}`))
    for (const chunk of diffLines(diff.oldText ?? '', diff.newText)) {
      const value = chunk.value.replace(/\n$/, '')
      if (value === '') continue
      if (chunk.added) lines.push(theme.success(`  + ${value}`))
      else if (chunk.removed) lines.push(theme.error(`  - ${value}`))
      else lines.push(theme.dim(`  ${value}`))
    }
  }
  return lines
}

/** Collapse output lines to the last N with an expand hint. */
function collapseLines(lines: readonly string[], expanded: boolean): string[] {
  if (expanded || lines.length <= MAX_TOOL_OUTPUT_LINES) return [...lines]
  const hidden = lines.length - MAX_TOOL_OUTPUT_LINES
  return [theme.dim(`  … (${hidden} earlier lines, ctrl+o to expand)`), ...lines.slice(-MAX_TOOL_OUTPUT_LINES)]
}

/** Build the blocks for one transcript item (assistant splits reasoning + markdown text). */
function renderItemBlocks(item: TranscriptItem, expanded: boolean): Component[] {
  switch (item.kind) {
    case 'user':
      return [new Text(`${theme.accent(theme.bold('›'))} ${item.text}`, 1, 1, theme.userBg)]
    case 'assistant': {
      const blocks: Component[] = []
      if (item.reasoning !== undefined && item.reasoning !== '') {
        const reasoning = expanded
          ? theme.italic(theme.dim(`◌ ${item.reasoning}`))
          : theme.dim(`${item.reasoningDurationMs !== undefined ? `Thought for ${Math.max(1, Math.round(item.reasoningDurationMs / 1000))}s` : 'Thought'} (ctrl+o to expand)`)
        blocks.push(new Text(reasoning, 1, 0))
      }
      if (item.text !== '') blocks.push(new Markdown(item.text, 1, 0, MARKDOWN_THEME))
      return blocks
    }
    case 'tool': {
      const lines: string[] = []
      const command = toolArgumentSummary(item.arguments)
      const head = `${theme.accent('⚙')} ${theme.bold(item.name)}`
      if (item.status === 'running') {
        lines.push(theme.warning(`${head} …`))
        if (command !== '') lines.push(theme.dim(`  $ ${command}`))
        return [new Text(lines.join('\n'), 1, 1, theme.toolBg)]
      }
      const mark = item.status === 'error' ? theme.error(`✗ ${item.errorCode ?? 'error'}`) : theme.success('✓')
      lines.push(`${head} ${mark}`)
      if (command !== '') lines.push(theme.dim(`  $ ${command}`))
      const output = item.diffs !== undefined && item.diffs.length > 0
        ? collapseLines(renderDiff(item.diffs), expanded)
        : item.resultText !== undefined && item.resultText !== ''
          ? collapseLines(item.resultText.split('\n').map(line => theme.dim(`  ${line}`)), expanded)
          : []
      lines.push(...output)
      if (item.elapsedMs !== undefined) lines.push(theme.dim(`  Took ${formatDuration(item.elapsedMs)}`))
      return [new Text(lines.join('\n'), 1, 1, theme.toolBg)]
    }
    case 'notice':
      return [new Text(theme.dim(`· ${item.text}`), 1, 0)]
  }
}

/** Build the live streaming draft blocks (reasoning text + streaming markdown). */
function renderDraftComponents(draft: AssistantDraft | undefined): Component[] {
  if (draft === undefined) return []
  const blocks: Component[] = []
  if (draft.reasoning !== '') blocks.push(new Text(theme.italic(theme.dim(`◌ ${draft.reasoning}`)), 1, 0))
  if (draft.text !== '') blocks.push(new Markdown(draft.text, 1, 0, MARKDOWN_THEME))
  return blocks
}

/** Assemble the status line, colorized. */
export function renderStatus(view: TuiViewModel, model?: { provider: string; model: string }): string {
  const parts: string[] = []
  if (model !== undefined) parts.push(theme.dim(`${model.provider}/${model.model}`))
  const phase = view.phase === 'running' ? theme.warning(view.phase)
    : view.phase === 'idle' ? theme.dim(view.phase)
      : theme.accent(view.phase)
  parts.push(phase)
  if (view.permission !== undefined) parts.push(theme.accent(view.permission))
  if (view.plan) parts.push(theme.accent('plan'))
  if (view.tokenUsage !== undefined) {
    parts.push(theme.dim(`↑${view.tokenUsage.inputTokens} ↓${view.tokenUsage.outputTokens}`))
  }
  if (view.todos.length > 0) {
    const inProgress = view.todos.find(todo => todo.status === 'in_progress')
    const done = view.todos.filter(todo => todo.status === 'completed').length
    parts.push(inProgress !== undefined ? theme.warning(`▸ ${inProgress.content}`) : theme.dim(`todo ${done}/${view.todos.length}`))
  }
  const runningSubagents = view.transcript.filter(item =>
    item.kind === 'tool' && (item.name === 'subagent' || item.name === 'subagent_fork') && item.status === 'running').length
  if (runningSubagents > 0) parts.push(theme.warning(`⚡ ${runningSubagents} subagent`))
  return parts.join(' · ')
}

/**
 * Owns the pi-tui surface. Terminal restoration is `stop()`'s job; the plugin
 * must guarantee `stop()` runs on every exit path (see ADR-001).
 */
export class TuiHost {
  readonly tui: TUI
  private readonly transcriptContainer: Container
  private readonly status: Text
  private readonly editor: Editor
  private readonly callbacks: TuiHostCallbacks
  private readonly detachInput: () => void
  private draft: AssistantDraft | undefined
  private model: { provider: string; model: string } | undefined
  private readonly notices: string[] = []
  private lastView: TuiViewModel | undefined
  private activeOverlayCancel: (() => void) | undefined
  private expanded = false
  private readonly workingContainer: Container
  private readonly workingLoader: Loader
  private readonly footer: Text
  private retryTimer: ReturnType<typeof setInterval> | undefined

  constructor(callbacks: TuiHostCallbacks) {
    this.callbacks = callbacks
    this.tui = new TuiMainScreen(new ProcessTerminal())
    this.transcriptContainer = new Container()
    this.status = new Text('', 1, 0)
    this.workingContainer = new Container()
    this.workingLoader = new Loader(this.tui, theme.accent, theme.dim, 'Working...')
    this.footer = new Text(theme.dim('Enter send · Ctrl+C cancel · Ctrl+O expand · Ctrl+D exit · / commands'), 1, 0)
    this.editor = new Editor(this.tui, EDITOR_THEME, { paddingX: 1 })
    this.editor.onSubmit = (text) => { this.callbacks.onSubmit(text) }

    const root = new Container()
    root.addChild(this.transcriptContainer)
    root.addChild(this.status)
    root.addChild(this.workingContainer)
    root.addChild(new Spacer())
    root.addChild(this.editor)
    root.addChild(this.footer)
    this.tui.addChild(root)
    this.tui.setFocus(this.editor)
    this.detachInput = this.tui.addInputListener(data => this.handleInput(data))
  }

  private handleInput(data: string): { consume: true } | undefined {
    if (this.activeOverlayCancel !== undefined && matchesKey(data, 'escape')) {
      this.activeOverlayCancel()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('c'))) { this.callbacks.onCancel(); return { consume: true } }
    if (matchesKey(data, Key.ctrl('d'))) { this.callbacks.onExit(); return { consume: true } }
    if (matchesKey(data, Key.ctrl('l'))) { this.callbacks.onRedraw(); return { consume: true } }
    if (matchesKey(data, Key.ctrl('o'))) {
      this.expanded = !this.expanded
      if (this.lastView !== undefined) this.render(this.lastView)
      return { consume: true }
    }
    return undefined
  }

  /** Update the rendered transcript/status from the reduced view model. */
  render(view: TuiViewModel): void {
    this.lastView = view
    this.transcriptContainer.clear()
    const blocks: Component[] = []
    for (const item of view.transcript) blocks.push(...renderItemBlocks(item, this.expanded))
    blocks.push(...renderDraftComponents(this.draft))
    if (this.notices.length > 0) blocks.push(new Text(this.notices.map(text => `· ${text}`).join('\n'), 1, 0))
    blocks.forEach((block, index) => {
      if (index > 0) this.transcriptContainer.addChild(new Spacer(1))
      this.transcriptContainer.addChild(block)
    })
    this.updateWorkingIndicator(view)
    this.status.setText(renderStatus(view, this.model))
    this.tui.requestRender()
  }

  /** The transient working-area message, from retry / compaction / running state. */
  private workingMessage(view: TuiViewModel): string | undefined {
    if (view.retryStatus !== undefined) {
      const remainingMs = Math.max(0, view.retryStatus.scheduledAt + view.retryStatus.delayMs - Date.now())
      const seconds = Math.ceil(remainingMs / 1000)
      const attempt = view.retryStatus.maxRetries !== undefined
        ? ` (${view.retryStatus.retry}/${view.retryStatus.maxRetries})`
        : ` (${view.retryStatus.retry})`
      return `Retrying${attempt} in ${seconds}s... (Ctrl+C to cancel)`
    }
    if (view.compacting) return 'Compacting context…'
    if (view.phase === 'running') return 'Working...'
    return undefined
  }

  private updateWorkingIndicator(view: TuiViewModel): void {
    const message = this.workingMessage(view)
    if (message === undefined) {
      this.workingContainer.clear()
      this.workingLoader.stop()
      this.clearRetryTimer()
      return
    }
    if (this.workingContainer.children.length === 0) {
      this.workingContainer.addChild(this.workingLoader)
      this.workingLoader.start()
    }
    this.workingLoader.setMessage(message)
    if (view.retryStatus !== undefined) this.ensureRetryTimer()
    else this.clearRetryTimer()
  }

  private ensureRetryTimer(): void {
    if (this.retryTimer !== undefined) return
    this.retryTimer = setInterval(() => {
      const view = this.lastView
      if (view?.retryStatus !== undefined) {
        const message = this.workingMessage(view)
        if (message !== undefined) this.workingLoader.setMessage(message)
        this.tui.requestRender()
      } else {
        this.clearRetryTimer()
      }
    }, 1000)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== undefined) {
      clearInterval(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  /** Show a transient UI-level notice (not a Session event). */
  showNotice(text: string): void {
    this.notices.push(text)
    if (this.lastView !== undefined) this.render(this.lastView)
    else this.tui.requestRender()
  }

  /** Update only the live streaming draft (throttled by the caller). */
  setDraft(draft: AssistantDraft | undefined): void {
    this.draft = draft
  }

  /** Pin the model provenance shown in the status line. */
  setModel(model: { provider: string; model: string }): void {
    this.model = model
  }

  /**
   * Enable slash-command autocomplete (plus `@` file completion) for the
   * editor. The provider is rebuilt and reattached whenever the command set
   * changes. `fdPath` enables the fast fuzzy `fd` file search when available.
   */
  setAutocomplete(commands: readonly SlashCommand[], basePath: string, fdPath?: string): void {
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider([...commands], basePath, fdPath ?? null))
  }

  getText(): string { return this.editor.getText() }
  setText(text: string): void { this.editor.setText(text) }
  clearEditor(): void { this.editor.setText('') }
  addHistory(text: string): void { this.editor.addToHistory(text) }
  setSubmitDisabled(disabled: boolean): void { this.editor.disableSubmit = disabled }

  /**
   * Build the once-only settle closure shared by the modal overlays: hide the
   * overlay, restore editor focus, and resolve exactly once.
   */
  private makeSettle(handle: OverlayHandle, resolve: (value: string | undefined) => void): (value: string | undefined) => void {
    let settled = false
    return (value) => {
      if (settled) return
      settled = true
      this.activeOverlayCancel = undefined
      handle.hide()
      this.tui.setFocus(this.editor)
      resolve(value)
    }
  }

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
      const settle = this.makeSettle(handle, resolve)
      this.activeOverlayCancel = () => { settle(undefined) }
      list.onSelect = (item) => { settle(item.value) }
      list.onCancel = () => { settle(undefined) }
      this.tui.setFocus(list)
    })
  }

  /**
   * Show a modal single-line text input and resolve the entered text, or
   * `undefined` when cancelled (Esc or empty submit).
   */
  askText(question: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const box = new Container()
      box.addChild(new Text(question, 1, 1))
      const input = new Editor(this.tui, EDITOR_THEME, { paddingX: 1 })
      box.addChild(input)
      const handle = this.tui.showOverlay(box)
      const settle = this.makeSettle(handle, resolve)
      this.activeOverlayCancel = () => { settle(undefined) }
      input.onSubmit = (text) => { settle(text.trim() === '' ? undefined : text.trim()) }
      this.tui.setFocus(input)
    })
  }

  start(): void { this.tui.start() }
  stop(): void { this.detachInput(); this.tui.stop() }
}
