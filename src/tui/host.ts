/**
 * Terminal host: a pi-tui alternate-screen viewport with a scrollable transcript
 * and a bottom-pinned interaction region (Todo, activity, editor, status).
 * It owns terminal lifecycle (raw mode, restore on stop) but no agent
 * semantics — those come from the plugin via callbacks.
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
  ScrollView,
  SelectList,
  Spacer,
  Text,
  TuiAltScreen,
  VStack,
  isKeyRelease,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type MarkdownTheme,
  type OverlayHandle,
  type SlashCommand,
  type TUI,
} from '@earendil-works/pi-tui'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { diffLines } from 'diff'
import { bindAdaptiveTheme, theme, type AdaptiveThemeBinding } from './theme.ts'
import { clipboardInvocation, writeClipboard } from './clipboard.ts'
import {
  InlineTextInputComponent,
  ListSelectorComponent,
  type InlineTextInputOptions,
  type SelectorOptions,
} from './selector.ts'
import type { TodoSummary, ToolDiff, TranscriptItem, TuiViewModel } from './view-model.ts'
import { ApprovalBarComponent, QuestionPanelComponent, type InlineApprovalRequest } from './interaction.ts'

/** Editor + autocomplete theme: DeepSeek-blue focus, semantic warning states. */
const EDITOR_THEME: EditorTheme = {
  borderColor: theme.border,
  selectList: {
    selectedPrefix: theme.accent,
    selectedText: theme.selected,
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
  onInterrupt(): void
  onExit(): void
  onRedraw(): void
  onEditorChange?(text: string): void
}

/** In-flight assistant stream (text + reasoning merged from `assistant/chunk`). */
export interface AssistantDraft {
  text: string
  reasoning: string
}

interface QueuedKernelInteraction {
  start(): void
  cancel(): void
}

/** Max result lines shown while a tool card is collapsed. */
const MAX_TOOL_OUTPUT_LINES = 5

/** Max visual reasoning lines shown while thinking is collapsed. */
const MAX_REASONING_LINES = 5

/** Format a millisecond duration for a timing footer. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Format a live turn duration as seconds, minutes+seconds, or hours+minutes+seconds. */
export function formatActivityDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 1) return `${seconds}s`
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return hours < 1 ? `${minutes}m ${seconds}s` : `${hours}h ${minutes}m ${seconds}s`
}

/** Suffix shared by interruptible activity messages. */
function activityHint(view: TuiViewModel, now: number): string {
  if (view.phase !== 'running') return ''
  const startedAt = view.turnStartedAt ?? now
  return ` (${formatActivityDuration(now - startedAt)} • esc to interrupt)`
}

/** Render the transient retry / compaction / active-turn message. */
export function renderWorkingMessage(view: TuiViewModel, now = Date.now()): string | undefined {
  if (view.retryStatus !== undefined) {
    const remainingMs = Math.max(0, view.retryStatus.scheduledAt + view.retryStatus.delayMs - now)
    const seconds = Math.ceil(remainingMs / 1000)
    const attempt = view.retryStatus.maxRetries !== undefined
      ? ` (${view.retryStatus.retry}/${view.retryStatus.maxRetries})`
      : ` (${view.retryStatus.retry})`
    return `Retrying${attempt} in ${seconds}s${activityHint(view, now)}`
  }
  if (view.compacting) return `Compacting context${activityHint(view, now) || '…'}`
  if (view.phase === 'running') return `Working${activityHint(view, now)}`
  return undefined
}

/** Esc interrupts only an active turn; inline controls and overlays take precedence. */
export function isTurnInterruptInput(data: string, view: TuiViewModel | undefined): boolean {
  return view?.phase === 'running' && matchesKey(data, 'escape')
}

/** Format a token count as a compact figure (8900 → 8.9K, 1000000 → 1M). */
function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
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

/** One rendered diff row with its full-width semantic background. */
export interface RenderedDiffRow {
  text: string
  kind: 'context' | 'added' | 'removed'
}

/** Split a diff chunk without inventing a line after its final newline. */
function diffChunkLines(value: string): string[] {
  if (value === '') return []
  const lines = value.split('\n')
  if (value.endsWith('\n')) lines.pop()
  return lines
}

/** Count logical lines using the same trailing-newline convention as diff chunks. */
function logicalLineCount(value: string): number {
  return diffChunkLines(value).length
}

/** Render write/edit diffs with old numbers for removals and new numbers otherwise. */
export function renderDiffRows(diffs: readonly ToolDiff[]): RenderedDiffRow[] {
  const rows: RenderedDiffRow[] = []
  for (const diff of diffs) {
    const oldText = diff.oldText ?? ''
    const numberWidth = Math.max(1, String(Math.max(logicalLineCount(oldText), logicalLineCount(diff.newText))).length)
    let oldLine = 1
    let newLine = 1
    rows.push({ text: theme.dim(`  ${diff.path}`), kind: 'context' })
    for (const chunk of diffLines(diff.oldText ?? '', diff.newText)) {
      for (const line of diffChunkLines(chunk.value)) {
        if (chunk.added) {
          const number = theme.dim(String(newLine).padStart(numberWidth))
          rows.push({ text: ` ${number} ${theme.success('+')}  ${line}`, kind: 'added' })
          newLine += 1
        } else if (chunk.removed) {
          const number = theme.dim(String(oldLine).padStart(numberWidth))
          rows.push({ text: ` ${number} ${theme.error('-')}  ${line}`, kind: 'removed' })
          oldLine += 1
        } else {
          const number = theme.dim(String(newLine).padStart(numberWidth))
          rows.push({ text: ` ${number}    ${line}`, kind: 'context' })
          oldLine += 1
          newLine += 1
        }
      }
    }
  }
  return rows
}

/** Collapse output lines to the last N with an expand hint. */
function collapseLines(lines: readonly string[], expanded: boolean): string[] {
  if (expanded || lines.length <= MAX_TOOL_OUTPUT_LINES) return [...lines]
  const hidden = lines.length - MAX_TOOL_OUTPUT_LINES
  return [theme.dim(`  … (${hidden} earlier lines, ctrl+o to expand)`), ...lines.slice(-MAX_TOOL_OUTPUT_LINES)]
}

/** Collapse structured diff rows while retaining their per-row backgrounds. */
function collapseDiffRows(rows: readonly RenderedDiffRow[], expanded: boolean): RenderedDiffRow[] {
  if (expanded || rows.length <= MAX_TOOL_OUTPUT_LINES) return [...rows]
  const hidden = rows.length - MAX_TOOL_OUTPUT_LINES
  return [
    { text: theme.dim(`  … (${hidden} earlier lines, ctrl+o to expand)`), kind: 'context' },
    ...rows.slice(-MAX_TOOL_OUTPUT_LINES),
  ]
}

/** Apply a semantic background and pad/truncate to exactly one terminal row. */
function paintFullRow(text: string, width: number, background: (value: string) => string): string {
  const fitted = truncateToWidth(text, width, '…')
  return background(fitted + ' '.repeat(Math.max(0, width - visibleWidth(fitted))))
}

/** Paint one semantic diff row across the complete terminal width. */
export function renderDiffRow(row: RenderedDiffRow, width: number): string {
  const background = row.kind === 'added' ? theme.diffAddedBg
    : row.kind === 'removed' ? theme.diffRemovedBg
      : theme.toolBg
  return paintFullRow(row.text, width, background)
}

type ToolCardRow = { text: string; kind: 'normal' } | RenderedDiffRow

/** Tool card that can paint individual diff rows while keeping one compact block. */
class ToolCard implements Component {
  constructor(private readonly rows: readonly ToolCardRow[]) {}
  invalidate(): void {}
  render(width: number): string[] {
    if (width <= 0) return []
    const output: string[] = [theme.toolBg(' '.repeat(width))]
    for (const row of this.rows) {
      if (row.kind === 'normal') {
        const padding = width >= 2 ? 1 : 0
        const contentWidth = Math.max(1, width - padding * 2)
        for (const wrapped of wrapTextWithAnsi(row.text, contentWidth)) {
          output.push(paintFullRow(`${' '.repeat(padding)}${wrapped}`, width, theme.toolBg))
        }
      } else {
        output.push(renderDiffRow(row, width))
      }
    }
    output.push(theme.toolBg(' '.repeat(width)))
    return output
  }
}

/** Render at most the latest five visual reasoning rows unless expanded. */
export function renderReasoningLines(reasoning: string, width: number, expanded: boolean): string[] {
  if (width <= 0 || reasoning === '') return []
  const padding = width >= 2 ? 1 : 0
  const prefixWidth = width - padding * 2 >= 3 ? 2 : 0
  const contentWidth = Math.max(1, width - padding * 2 - prefixWidth)
  const wrapped = wrapTextWithAnsi(theme.italic(theme.dim(reasoning)), contentWidth)
  const truncated = !expanded && wrapped.length > MAX_REASONING_LINES
  const visible = truncated ? wrapped.slice(-MAX_REASONING_LINES) : wrapped
  return visible.map((line, index) => {
    const prefix = prefixWidth === 0 ? '' : index === 0 ? (truncated ? '… ' : '◌ ') : '  '
    const content = truncateToWidth(`${' '.repeat(padding)}${prefix}${line}`, width, '…')
    return content + ' '.repeat(Math.max(0, width - visibleWidth(content)))
  })
}

/** Width-aware reasoning window shared by committed and streaming thoughts. */
class ReasoningBlock implements Component {
  constructor(private readonly reasoning: string, private readonly expanded: boolean) {}
  invalidate(): void {}
  render(width: number): string[] { return renderReasoningLines(this.reasoning, width, this.expanded) }
}

/** Build the blocks for one transcript item (assistant splits reasoning + markdown text). */
function renderItemBlocks(item: TranscriptItem, expanded: boolean): Component[] {
  switch (item.kind) {
    case 'user':
      return [new Text(`${theme.accent(theme.bold('›'))} ${item.text}`, 1, 1, theme.userBg)]
    case 'assistant': {
      const blocks: Component[] = []
      if (item.reasoning !== undefined && item.reasoning !== '') {
        blocks.push(new ReasoningBlock(item.reasoning, expanded))
      }
      if (item.text !== '') blocks.push(new Markdown(item.text, 1, 0, MARKDOWN_THEME))
      return blocks
    }
    case 'tool': {
      const rows: ToolCardRow[] = []
      const command = toolArgumentSummary(item.arguments)
      const head = `${theme.accent('⚙')} ${theme.bold(item.name)}`
      if (item.status === 'running') {
        rows.push({ text: theme.warning(`${head} …`), kind: 'normal' })
        if (command !== '') rows.push({ text: theme.dim(`  $ ${command}`), kind: 'normal' })
        return [new ToolCard(rows)]
      }
      const mark = item.status === 'error' ? theme.error(`✗ ${item.errorCode ?? 'error'}`) : theme.success('✓')
      rows.push({ text: `${head} ${mark}`, kind: 'normal' })
      if (command !== '') rows.push({ text: theme.dim(`  $ ${command}`), kind: 'normal' })
      if (item.diffs !== undefined && item.diffs.length > 0) {
        rows.push(...collapseDiffRows(renderDiffRows(item.diffs), expanded))
      } else if (item.resultText !== undefined && item.resultText !== '') {
        rows.push(...collapseLines(item.resultText.split('\n').map(line => theme.dim(`  ${line}`)), expanded)
          .map(text => ({ text, kind: 'normal' as const })))
      }
      if (item.elapsedMs !== undefined) rows.push({ text: theme.dim(`  Took ${formatDuration(item.elapsedMs)}`), kind: 'normal' })
      return [new ToolCard(rows)]
    }
    case 'notice':
      return [new Text(theme.dim(`· ${item.text}`), 1, 0)]
  }
}

/** Build the live streaming draft blocks (reasoning text + streaming markdown). */
function renderDraftComponents(draft: AssistantDraft | undefined, expanded: boolean): Component[] {
  if (draft === undefined) return []
  const blocks: Component[] = []
  if (draft.reasoning !== '') blocks.push(new ReasoningBlock(draft.reasoning, expanded))
  if (draft.text !== '') blocks.push(new Markdown(draft.text, 1, 0, MARKDOWN_THEME))
  return blocks
}

/** A shell-command result, shown in a bordered block. */
interface ShellResult {
  command: string
  output: string
  status: string
}

/** A bordered shell-result block, using the shell-mode border color. */
class ShellResultBlock implements Component {
  constructor(
    private readonly command: string,
    private readonly output: string,
    private readonly status: string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const border = theme.bashBorder('─'.repeat(Math.max(1, width)))
    const lines: string[] = [border, ` $ ${this.command}`]
    if (this.output !== '') {
      lines.push('')
      for (const line of this.output.split('\n')) lines.push(` ${line}`)
    }
    if (this.status !== '') {
      lines.push('')
      lines.push(theme.dim(` ${this.status}`))
    }
    lines.push(border)
    return lines
  }
}

/** Build the bordered shell-result blocks (one per executed command). */
function renderShellResultBlocks(results: readonly ShellResult[]): Component[] {
  return results.map(result => new ShellResultBlock(result.command, result.output, result.status))
}

/** Assemble the left-hand status line, colorized. */
export function renderStatus(view: TuiViewModel, model?: { provider: string; model: string }, contextTokens?: number): string {
  const parts: string[] = []
  if (model !== undefined) {
    const effort = view.reasoningEffort !== undefined ? theme.dim(`(${view.reasoningEffort})`) : ''
    parts.push(`${theme.accent(model.model)}${effort}`)
  }
  if (view.permission !== undefined) parts.push(theme.accent(view.permission))
  if (view.plan) parts.push(theme.accent('plan'))
  if (contextTokens !== undefined) {
    const window = view.contextWindow
    parts.push(theme.dim(window !== undefined ? `ctx ${formatTokens(contextTokens)}/${formatTokens(window)}` : `ctx ${formatTokens(contextTokens)}`))
  }
  if (view.tokenUsage !== undefined) {
    const { inputTokens, cacheReadTokens, cacheWriteTokens } = view.tokenUsage
    const totalInput = inputTokens + cacheReadTokens + cacheWriteTokens
    if (totalInput > 0 && cacheReadTokens > 0) {
      parts.push(theme.dim(`cached ${((cacheReadTokens / totalInput) * 100).toFixed(1)}%`))
    }
  }
  const runningSubagents = view.transcript.filter(item =>
    item.kind === 'tool' && (item.name === 'subagent' || item.name === 'subagent_fork') && item.status === 'running').length
  if (runningSubagents > 0) parts.push(theme.warning(`⚡ ${runningSubagents} subagent`))
  return parts.join(' · ')
}

/** Render the persistent Todo panel, one width-safe row per model-owned task. */
export function renderTodoLines(todos: readonly TodoSummary[], width: number): string[] {
  if (width <= 0) return []
  return todos.map((todo) => {
    const content = todo.content.replace(/\s+/g, ' ').trim()
    const line = (() => {
      switch (todo.status) {
        case 'completed':
          return ` ${theme.success('✓')} ${theme.dim(content)}`
        case 'in_progress':
          return ` ${theme.accent('▸')} ${theme.bold(content)}`
        case 'pending':
          return theme.dim(` ○ ${content}`)
      }
    })()
    return truncateToWidth(line, width, '…')
  })
}

/** Add one blank row around a non-empty Todo list to separate adjacent UI. */
export function renderTodoPanel(todos: readonly TodoSummary[], width: number): string[] {
  const lines = renderTodoLines(todos, width)
  return lines.length === 0 ? [] : ['', ...lines, '']
}

/** Fixed task panel kept separate from the compact model/context status row. */
class TodoList implements Component {
  private todos: readonly TodoSummary[] = []
  set(todos: readonly TodoSummary[]): void { this.todos = todos }
  invalidate(): void {}
  render(width: number): string[] { return renderTodoPanel(this.todos, width) }
}

/**
 * Build the full-height viewport: only transcript content scrolls, while all
 * interactive/status components retain their intrinsic height at the bottom.
 */
export function createMainViewportLayout(transcript: Component, bottom: Component): VStack {
  const transcriptScroll = new ScrollView(transcript, {
    follow: 'end',
    primary: true,
    overscroll: 'contain',
    scrollbar: 'hidden',
  })
  // When the transcript is shorter than its viewport, grow only the spacer
  // above it so the latest content sits immediately above the interaction
  // region. Once content exceeds the viewport the spacer collapses to zero and
  // ScrollView owns the full region as usual.
  const bottomAlignedTranscript = new VStack([
    { component: new Spacer(0), basis: 0, grow: 1, minSize: 0 },
    { component: transcriptScroll, basis: 'auto', shrink: 1, minSize: 1 },
  ])
  return new VStack([
    { component: bottomAlignedTranscript, basis: 0, grow: 1, minSize: 1 },
    { component: bottom, basis: 'auto', shrink: 1, minSize: 1 },
  ])
}

/**
 * Fit a status row to exactly the terminal width. The right project label gets
 * at most 35% of the inner row; the activity/status side owns the remainder.
 * Both sides are ANSI/CJK-aware and truncate rather than crashing pi-tui.
 */
export function layoutStatusLine(left: string, right: string, width: number): string {
  if (width <= 0) return ''
  const innerWidth = Math.max(0, width - 2)
  if (innerWidth === 0) return ' '.repeat(width)

  let content: string
  if (right === '' || innerWidth < 8) {
    content = truncateToWidth(left, innerWidth, '…')
  } else {
    const rightLimit = Math.max(1, Math.floor(innerWidth * 0.35))
    const fittedRight = truncateToWidth(right, rightLimit, '…')
    const fittedRightWidth = visibleWidth(fittedRight)
    const leftLimit = Math.max(1, innerWidth - fittedRightWidth - 1)
    const fittedLeft = truncateToWidth(left, leftLimit, '…')
    const gap = Math.max(1, innerWidth - visibleWidth(fittedLeft) - fittedRightWidth)
    content = `${fittedLeft}${' '.repeat(gap)}${fittedRight}`
  }
  const padding = ' '.repeat(Math.max(0, innerWidth - visibleWidth(content)))
  return ` ${content}${padding} `
}

/** A resize-safe status line with a right-aligned project suffix. */
class StatusLine implements Component {
  private left = ''
  private right = ''
  set(left: string, right: string): void {
    this.left = left
    this.right = right
  }
  invalidate(): void {}
  render(width: number): string[] {
    if (this.left === '') return []
    return [layoutStatusLine(this.left, this.right, width)]
  }
}

/** Pad a (possibly ANSI-colored) string to a fixed visible width. */
function padVisible(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)))
}

/** Center `text` within `width`, preserving ANSI visible width. */
function centerText(text: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(text))
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + text + ' '.repeat(pad - left)
}

/** Original 76×28 welcome-whale bitmap (`#` = filled source pixel). */
export const WELCOME_WHALE_SOURCE: readonly string[] = [
  '                                                    ##',
  '                               #########           ####',
  '             #########################             ######                 ##',
  '          ############################             #########            ####',
  '       #################################           ##########   ############',
  '     #####################################         ########################',
  '    #########################################       ######################',
  '   ############################################       ###################',
  '  ###############################################       ###############',
  ' ##################################################      #########',
  '#####          #######################################  ########',
  '#####                ###################    ####################',
  '#####                   ##################     ################',
  '######                     ############# ###    ###############',
  '######                       ###############      ############',
  '#######                        #############      ############',
  ' #######                        #############################',
  ' #######                          ##########################',
  '  ########                         ########################',
  '   ########                         ######################',
  '    ########             ##           ##################',
  '     #########           #####         ################',
  '       ##########         #######        #############',
  '         ###########      ##########       ###############',
  '           ############################      ###############',
  '              ################################    ########',
  '                 ##########################',
  '                      ################',
]

/** Unicode glyphs representing every possible filled quadrant in a 2×2 cell. */
const QUADRANT_GLYPHS: readonly string[] = [
  ' ', '▗', '▖', '▄', '▝', '▐', '▞', '▟', '▘', '▚', '▌', '▙', '▀', '▜', '▛', '█',
]

/**
 * Reduce a monochrome bitmap to exactly half its source rows/columns. Each
 * terminal cell retains its source 2×2 coverage through a quadrant glyph.
 */
export function halveBlockArt(source: readonly string[]): string[] {
  const sourceWidth = Math.max(0, ...source.map(line => line.length))
  const output: string[] = []
  for (let row = 0; row < source.length; row += 2) {
    let line = ''
    for (let column = 0; column < sourceWidth; column += 2) {
      const filled = (sourceRow: number, sourceColumn: number): boolean =>
        (source[sourceRow]?.[sourceColumn] ?? ' ') !== ' '
      const mask = (filled(row, column) ? 8 : 0)
        | (filled(row, column + 1) ? 4 : 0)
        | (filled(row + 1, column) ? 2 : 0)
        | (filled(row + 1, column + 1) ? 1 : 0)
      line += QUADRANT_GLYPHS[mask] ?? ' '
    }
    output.push(line.trimEnd())
  }
  return output
}

/** Half-size 38×14 whale, colored DeepSeek blue only when rendered. */
export const WELCOME_WHALE: readonly string[] = halveBlockArt(WELCOME_WHALE_SOURCE)

/** The usage tips shown beside the whale on a fresh session. */
const TIPS: readonly string[] = [
  '/ for commands',
  process.platform === 'win32' ? '! to run PowerShell' : '! to run shell',
  '@ to reference files',
]

const WELCOME_SIDE_MARGIN = 2
const WELCOME_WHALE_GAP = 2

/** Add a centered compact frame around the responsive welcome content. */
export function renderWelcomeBanner(version: string, width: number): string[] {
  if (width <= 0) return []
  if (width < 20) return [truncateToWidth(theme.bold('Welcome back!'), width, '…')]

  const sideMargin = Math.min(WELCOME_SIDE_MARGIN, Math.max(0, Math.floor((width - 20) / 2)))
  const boxWidth = width - sideMargin * 2
  const indent = ' '.repeat(sideMargin)
  const title = truncateToWidth(theme.accent(`dsh-code v${version}`), Math.max(1, boxWidth - 5), '…')
  const top = `╭─ ${title} ${'─'.repeat(Math.max(0, boxWidth - visibleWidth(title) - 5))}╮`
  const bottom = `╰${'─'.repeat(Math.max(0, boxWidth - 2))}╯`
  const whaleWidth = Math.max(...WELCOME_WHALE.map(line => visibleWidth(line)))
  const tipsWidth = Math.max(...TIPS.map(line => visibleWidth(line)), visibleWidth('Tips'))
  const sideBySide = boxWidth >= whaleWidth + tipsWidth + 9
  const body: string[] = []

  if (sideBySide) {
    const leftWidth = Math.max(whaleWidth + 2, Math.floor((boxWidth - 7) * 0.58))
    const rightWidth = boxWidth - 7 - leftWidth
    const whaleOffset = Math.max(0, Math.floor((leftWidth - whaleWidth) / 2))
    const left = [
      centerText(theme.bold('Welcome back!'), leftWidth),
      ...Array.from({ length: WELCOME_WHALE_GAP }, () => ''),
      ...WELCOME_WHALE.map(line => padVisible(' '.repeat(whaleOffset) + theme.whale(line), leftWidth)),
      '',
    ]
    const tips = [
      centerText(theme.bold('Tips'), rightWidth),
      ...TIPS.map(line => centerText(theme.dim(line), rightWidth)),
    ]
    const tipsOffset = Math.max(0, Math.floor((left.length - tips.length) / 2))
    const right = [...Array.from({ length: tipsOffset }, () => ''), ...tips]
    for (let index = 0; index < left.length; index++) {
      body.push(`│ ${padVisible(left[index] ?? '', leftWidth)} │ ${padVisible(right[index] ?? '', rightWidth)} │`)
    }
  } else {
    const contentWidth = Math.max(1, boxWidth - 4)
    const whaleOffset = Math.max(0, Math.floor((contentWidth - whaleWidth) / 2))
    body.push(`│ ${centerText(theme.bold('Welcome back!'), contentWidth)} │`)
    for (let index = 0; index < WELCOME_WHALE_GAP; index++) body.push(`│ ${' '.repeat(contentWidth)} │`)
    for (const whaleLine of WELCOME_WHALE) {
      const line = truncateToWidth(' '.repeat(whaleOffset) + theme.whale(whaleLine), contentWidth, '')
      body.push(`│ ${padVisible(line, contentWidth)} │`)
    }
    body.push(`│ ${' '.repeat(contentWidth)} │`)
    body.push(`├${'─'.repeat(Math.max(0, boxWidth - 2))}┤`)
    body.push(`│ ${centerText(theme.bold('Tips'), contentWidth)} │`)
    for (const tip of TIPS) {
      const fittedTip = truncateToWidth(theme.dim(tip), contentWidth, '…')
      body.push(`│ ${centerText(fittedTip, contentWidth)} │`)
    }
  }

  return [top, ...body, bottom].map(line => indent + line)
}

/** The boxed welcome banner shown at the top of a fresh (empty) session. */
class WelcomeBanner implements Component {
  private readonly version: string
  constructor(version: string) { this.version = version }
  invalidate(): void {}
  render(width: number): string[] { return renderWelcomeBanner(this.version, width) }
}

/**
 * Owns the pi-tui surface. Terminal restoration is `stop()`'s job; the plugin
 * must guarantee `stop()` runs on every exit path (see ADR-001).
 */
export class TuiHost {
  readonly tui: TUI
  private readonly transcriptContainer: Container
  private readonly todoList: TodoList
  private readonly status: StatusLine
  private readonly editor: Editor
  private readonly callbacks: TuiHostCallbacks
  private readonly detachInput: () => void
  private draft: AssistantDraft | undefined
  private model: { provider: string; model: string } | undefined
  private contextTokens: number | undefined
  private projectName = ''
  private projectBranch: string | undefined
  private version = '0.0.0'
  private readonly notices: string[] = []
  private readonly shellResults: ShellResult[] = []
  private lastView: TuiViewModel | undefined
  private activeOverlayCancel: (() => void) | undefined
  private expanded = false
  private readonly workingContainer: Container
  private readonly workingLoader: Loader
  private readonly footer: Text
  private readonly editorSlot: Container
  private workingTimer: ReturnType<typeof setInterval> | undefined
  private shellMode = false
  private readonly inlineContainer: Container
  private inlineControlActive = false
  private readonly kernelInteractionQueue: QueuedKernelInteraction[] = []
  private activeKernelInteractionCancel: (() => void) | undefined
  private stopped = false
  private adaptiveTheme: AdaptiveThemeBinding | undefined

  constructor(callbacks: TuiHostCallbacks) {
    this.callbacks = callbacks
    // Keep pi-tui's OSC 52 fallback on platforms without a native bridge.
    const copySelection = clipboardInvocation('', process.platform) === undefined ? undefined : writeClipboard
    const tuiOptions = copySelection === undefined ? {} : { copySelection }
    const tui = new TuiAltScreen(new ProcessTerminal(), undefined, undefined, tuiOptions)
    this.tui = tui
    this.transcriptContainer = new Container()
    this.inlineContainer = new Container()
    this.todoList = new TodoList()
    this.status = new StatusLine()
    this.workingContainer = new Container()
    this.workingLoader = new Loader(this.tui, theme.accent, theme.dim, 'Working...')
    this.footer = new Text(theme.dim('Enter send · Esc back · Ctrl+O expand · Ctrl+D exit · / commands'), 1, 0)
    this.editor = new Editor(this.tui, EDITOR_THEME, { paddingX: 1 })
    this.editor.onSubmit = (text) => { this.callbacks.onSubmit(text) }
    this.editor.onChange = (text) => { this.callbacks.onEditorChange?.(text) }
    this.editorSlot = new Container()
    this.editorSlot.addChild(new Spacer())
    this.editorSlot.addChild(this.editor)

    const bottom = new Container()
    bottom.addChild(this.inlineContainer)
    bottom.addChild(this.todoList)
    bottom.addChild(this.workingContainer)
    bottom.addChild(this.editorSlot)
    bottom.addChild(this.status)
    bottom.addChild(this.footer)
    tui.setLayoutRoot(createMainViewportLayout(this.transcriptContainer, bottom))
    this.tui.setFocus(this.editor)
    this.detachInput = this.tui.addInputListener(data => this.handleInput(data))
  }

  private handleInput(data: string): { consume: true } | undefined {
    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.super('c'))) {
      if (!isKeyRelease(data)) this.copyTranscriptSelection()
      return { consume: true }
    }
    // While an inline selector/input is active, let it own every key.
    if (this.inlineControlActive) return undefined
    if (this.activeOverlayCancel !== undefined && matchesKey(data, 'escape')) {
      this.activeOverlayCancel()
      return { consume: true }
    }
    if (isTurnInterruptInput(data, this.lastView)) { this.callbacks.onInterrupt(); return { consume: true } }
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
    if (view.transcript.length === 0) blocks.push(new WelcomeBanner(this.version))
    for (const item of view.transcript) blocks.push(...renderItemBlocks(item, this.expanded))
    blocks.push(...renderDraftComponents(this.draft, this.expanded))
    blocks.push(...renderShellResultBlocks(this.shellResults))
    if (this.notices.length > 0) blocks.push(new Text(this.notices.map(text => `· ${text}`).join('\n'), 1, 0))
    blocks.forEach((block, index) => {
      if (index > 0) this.transcriptContainer.addChild(new Spacer(1))
      this.transcriptContainer.addChild(block)
    })
    this.todoList.set(view.todos)
    this.updateWorkingIndicator(view)
    this.status.set(renderStatus(view, this.model, this.contextTokens), this.projectLabel())
    this.tui.requestRender()
  }

  /** Copy pi-tui's application-owned transcript selection through its pinned selection seam. */
  private copyTranscriptSelection(): void {
    const selectionTui = this.tui as TUI & { copySelectionToClipboard?: () => Promise<void> }
    if (selectionTui.copySelectionToClipboard !== undefined) {
      void selectionTui.copySelectionToClipboard.call(this.tui)
    }
  }

  private updateWorkingIndicator(view: TuiViewModel): void {
    // A human decision is the active foreground work. Keeping the spinner below
    // it suggests the model is still generating and wastes scarce bottom-panel
    // space, so pause it until the interaction settles.
    if (this.activeKernelInteractionCancel !== undefined) {
      this.workingContainer.clear()
      this.workingLoader.stop()
      this.clearWorkingTimer()
      return
    }
    const message = renderWorkingMessage(view)
    if (message === undefined) {
      this.workingContainer.clear()
      this.workingLoader.stop()
      this.clearWorkingTimer()
      return
    }
    if (this.workingContainer.children.length === 0) {
      this.workingContainer.addChild(this.workingLoader)
      this.workingLoader.start()
    }
    this.workingLoader.setMessage(message)
    if (view.phase === 'running') this.ensureWorkingTimer()
    else this.clearWorkingTimer()
  }

  private ensureWorkingTimer(): void {
    if (this.workingTimer !== undefined) return
    this.workingTimer = setInterval(() => {
      const view = this.lastView
      if (view?.phase === 'running') {
        const message = renderWorkingMessage(view)
        if (message !== undefined) this.workingLoader.setMessage(message)
        this.tui.requestRender()
      } else {
        this.clearWorkingTimer()
      }
    }, 1000)
  }

  private clearWorkingTimer(): void {
    if (this.workingTimer !== undefined) {
      clearInterval(this.workingTimer)
      this.workingTimer = undefined
    }
  }

  /** Show a transient UI-level notice (not a Session event). */
  showNotice(text: string): void {
    this.notices.push(text)
    if (this.lastView !== undefined) this.render(this.lastView)
    else this.tui.requestRender()
  }

  /** Show a bordered shell-command result block. */
  showShellResult(command: string, output: string, status: string): void {
    this.shellResults.push({ command, output, status })
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

  /** Set the current request context size (tokens) for the status line. */
  setContextTokens(tokens: number): void {
    this.contextTokens = tokens
  }

  /** Set the project directory name and (optional) git branch for the status line. */
  setProject(name: string, branch: string | undefined): void {
    this.projectName = name
    this.projectBranch = branch
  }

  /** Set the product version shown in the welcome banner. */
  setVersion(version: string): void {
    this.version = version
  }

  /** Right-aligned project label (directory name + git branch), if set. */
  private projectLabel(): string {
    if (this.projectName === '') return ''
    const name = theme.accent(this.projectName)
    if (this.projectBranch === undefined) return name
    return `${name} · ${theme.accent(this.projectBranch)}`
  }

  /**
   * Enable slash-command autocomplete (plus `@` file completion) for the
   * editor. The provider is rebuilt and reattached whenever the command set
   * changes. `fdPath` enables the fast fuzzy `fd` file search when available.
   */
  setAutocomplete(commands: readonly SlashCommand[], basePath: string, fdPath?: string): void {
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider([...commands], basePath, fdPath ?? null))
  }

  /** Toggle the editor's shell-mode border color (deduplicated). */
  setShellMode(active: boolean): void {
    if (this.shellMode === active) return
    this.shellMode = active
    this.editor.borderColor = active ? theme.bashBorder : theme.border
    this.tui.requestRender()
  }

  /** Mount an inline list selector, hide the editor, focus it, and route input to it. */
  showSelector(options: SelectorOptions): void {
    const selector = new ListSelectorComponent({
      ...options,
      onSelect: (value) => { this.clearInlineControl(); options.onSelect(value) },
      onCancel: () => { this.clearInlineControl(); options.onCancel() },
    })
    this.mountInlineControl(selector)
  }

  /** Mount an inline single-line field; Esc invokes the caller's back step. */
  showInlineInput(options: InlineTextInputOptions): void {
    const input = new InlineTextInputComponent({
      ...options,
      onSubmit: (value) => { this.clearInlineControl(); options.onSubmit(value) },
      onCancel: () => { this.clearInlineControl(); options.onCancel() },
    })
    this.mountInlineControl(input)
  }

  /** Show one tool approval in the shared bottom-pinned interaction queue. */
  askApproval(
    request: InlineApprovalRequest,
    signal?: AbortSignal,
  ): Promise<'allowed-once' | 'rejected' | undefined> {
    return this.enqueueKernelInteraction(signal, settle => new ApprovalBarComponent(
      request,
      outcome => { settle(outcome) },
      () => { settle(undefined) },
    ))
  }

  /** Collect a complete structured answer batch for ask_user_question/plan review. */
  askQuestions(
    questions: readonly AskUserQuestionItem[],
    signal?: AbortSignal,
  ): Promise<AskUserQuestionAnswer | undefined> {
    return this.enqueueKernelInteraction(signal, settle => new QuestionPanelComponent(
      questions,
      answer => { settle(answer) },
      () => { settle(undefined) },
    ))
  }

  /** Serialize kernel-owned interactions so parallel tool calls cannot replace each other's UI. */
  private enqueueKernelInteraction<T>(
    signal: AbortSignal | undefined,
    create: (settle: (value: T | undefined) => void) => Component & { focused: boolean },
  ): Promise<T | undefined> {
    return new Promise(resolve => {
      let started = false
      let settled = false
      const onAbort = (): void => { settle(undefined) }
      const settle = (value: T | undefined): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        if (started) {
          this.activeKernelInteractionCancel = undefined
          this.clearInlineControl()
          if (this.lastView !== undefined) this.updateWorkingIndicator(this.lastView)
        }
        resolve(value)
      }
      const entry: QueuedKernelInteraction = {
        start: () => {
          if (settled || this.stopped) { settle(undefined); this.pumpKernelInteractions(); return }
          started = true
          this.activeKernelInteractionCancel = () => { settle(undefined) }
          try {
            this.mountInlineControl(create(settle))
            if (this.lastView !== undefined) this.updateWorkingIndicator(this.lastView)
          } catch {
            settle(undefined)
          }
        },
        cancel: () => { settle(undefined) },
      }
      if (signal?.aborted === true || this.stopped) {
        settle(undefined)
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.kernelInteractionQueue.push(entry)
      this.pumpKernelInteractions()
    })
  }

  private pumpKernelInteractions(): void {
    if (this.stopped || this.inlineControlActive || this.activeKernelInteractionCancel !== undefined) return
    const next = this.kernelInteractionQueue.shift()
    if (next !== undefined) next.start()
  }

  /** Replace the active inline control, hide the editor, and transfer focus. */
  private mountInlineControl(control: Component & { focused: boolean }): void {
    this.inlineContainer.clear()
    this.inlineContainer.addChild(control)
    this.editorSlot.clear()
    this.inlineControlActive = true
    this.tui.setFocus(control)
    this.tui.requestRender()
  }

  /** Dismiss the active inline control and return focus to the editor. */
  clearInlineControl(): void {
    this.inlineContainer.clear()
    if (this.editorSlot.children.length === 0) {
      this.editorSlot.addChild(new Spacer())
      this.editorSlot.addChild(this.editor)
    }
    this.inlineControlActive = false
    this.tui.setFocus(this.editor)
    this.tui.requestRender()
    // Config wizards synchronously mount their next step after clearing the
    // current one. Deferring the pump prevents a queued kernel prompt from
    // being mounted and immediately replaced inside that callback.
    queueMicrotask(() => { this.pumpKernelInteractions() })
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

  start(): void {
    this.stopped = false
    this.tui.start()
    this.adaptiveTheme = bindAdaptiveTheme(this.tui, () => {
      if (this.lastView !== undefined) this.render(this.lastView)
    })
    void this.adaptiveTheme.detect()
  }
  stop(): void {
    this.stopped = true
    const queued = this.kernelInteractionQueue.splice(0)
    for (const interaction of queued) interaction.cancel()
    this.activeKernelInteractionCancel?.()
    this.activeKernelInteractionCancel = undefined
    this.clearWorkingTimer()
    this.adaptiveTheme?.dispose()
    this.adaptiveTheme = undefined
    this.detachInput()
    this.tui.stop()
  }
}
