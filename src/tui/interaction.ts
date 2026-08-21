/**
 * Bottom-pinned human-interaction panels used by approval requests,
 * ask_user_question, and plan review. These components only collect UI input;
 * DSH services remain responsible for policy, validation, and durable events.
 * @module dsh-code/tui/interaction
 */

import {
  Input,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type MarkdownTheme,
} from '@earendil-works/pi-tui'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions'
import { theme } from './theme.ts'

const DETAIL_PAGE_LINES = 6
const OPTION_PAGE_LINES = 8

const DETAIL_MARKDOWN_THEME: MarkdownTheme = {
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

function border(width: number): string {
  return theme.selectorBorder('─'.repeat(Math.max(1, width)))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return truncateToWidth(text, width, '…')
}

function wrap(text: string, width: number): string[] {
  if (width <= 0 || text === '') return []
  return wrapTextWithAnsi(text, width).map(line => fit(line, width))
}

/** Information carried by one tool approval request. */
export interface InlineApprovalRequest {
  toolName: string
  callId?: string
  reason?: string
}

/** One-shot inline approval bar: Allow once / Reject / Esc cancel. */
export class ApprovalBarComponent implements Component, Focusable {
  private selectedIndex = 0
  private _focused = false

  constructor(
    private readonly request: InlineApprovalRequest,
    private readonly onSelect: (outcome: 'allowed-once' | 'rejected') => void,
    private readonly onCancel: () => void,
  ) {}

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value }
  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 0) return []
    const call = this.request.callId === undefined ? '' : theme.dim(` · ${this.request.callId}`)
    const lines = [
      border(width),
      fit(`${theme.warning('Approval required')} · ${theme.bold(this.request.toolName)}${call}`, width),
    ]
    if (this.request.reason !== undefined && this.request.reason !== '') {
      lines.push(...wrap(theme.dim(this.request.reason), width))
    }
    const labels = ['Allow once', 'Reject'] as const
    lines.push(...labels.map((label, index) => index === this.selectedIndex
      ? theme.selected(`→ ${label}`)
      : `  ${label}`))
    lines.push(theme.dim('↑↓ select · Enter confirm · Esc cancel'))
    lines.push(border(width))
    return lines.map(line => fit(line, width))
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'up') || matchesKey(data, 'left')) { this.selectedIndex = 0; return }
    if (matchesKey(data, 'down') || matchesKey(data, 'right')) { this.selectedIndex = 1; return }
    if (matchesKey(data, 'enter')) {
      this.onSelect(this.selectedIndex === 0 ? 'allowed-once' : 'rejected')
      return
    }
    if (matchesKey(data, 'escape')) this.onCancel()
  }
}

type QuestionEntry =
  | { kind: 'option'; label: string }
  | { kind: 'other' }
  | { kind: 'continue' }

/** Stateful structured-question menu shared by generic asks and plan review. */
export class QuestionPanelComponent implements Component, Focusable {
  private readonly answers: AskUserQuestionAnswerItem[] = []
  private readonly customInput = new Input()
  private questionIndex = 0
  private cursor = 0
  private detailOffset = 0
  private selected = new Set<string>()
  private custom: string | undefined
  private customMode = false
  private error: string | undefined
  private _focused = false

  constructor(
    private readonly questions: readonly AskUserQuestionItem[],
    private readonly onSubmit: (answer: AskUserQuestionAnswer) => void,
    private readonly onCancel: () => void,
  ) {
    if (questions.length === 0) throw new Error('question panel requires at least one question')
    this.customInput.onSubmit = value => { this.acceptCustom(value) }
    this.customInput.onEscape = () => {
      if ((this.current().options?.length ?? 0) === 0) { this.onCancel(); return }
      this.customMode = false
      this.customInput.focused = false
      this.error = undefined
    }
    if ((this.current().options?.length ?? 0) === 0) this.enterCustomMode()
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) {
    this._focused = value
    this.customInput.focused = value && this.customMode
  }

  invalidate(): void { this.customInput.invalidate() }

  private current(): AskUserQuestionItem {
    return this.questions[this.questionIndex] as AskUserQuestionItem
  }

  private entries(): QuestionEntry[] {
    const question = this.current()
    const options: QuestionEntry[] = (question.options ?? []).map(option => ({ kind: 'option', label: option.label }))
    if (options.length === 0) return []
    options.push({ kind: 'other' })
    if (question.multiSelect === true) options.push({ kind: 'continue' })
    return options
  }

  private move(delta: number): void {
    const count = this.entries().length
    if (count === 0) return
    this.cursor = (this.cursor + delta + count) % count
    this.error = undefined
  }

  private enterCustomMode(): void {
    this.customMode = true
    this.customInput.setValue(this.custom ?? '')
    this.customInput.handleInput('\x05')
    this.customInput.focused = this._focused
    this.error = undefined
  }

  private acceptCustom(value: string): void {
    const custom = value.trim()
    if (custom === '') { this.error = 'Enter a custom answer before continuing.'; return }
    this.custom = custom
    this.customMode = false
    this.customInput.focused = false
    if (this.current().multiSelect === true) {
      this.cursor = Math.max(0, this.entries().length - 1)
      return
    }
    this.completeCurrent({ id: this.current().id, selected: [], custom })
  }

  private completeCurrent(answer: AskUserQuestionAnswerItem): void {
    this.answers.push(answer)
    if (this.questionIndex === this.questions.length - 1) {
      this.onSubmit({ answers: [...this.answers] })
      return
    }
    this.questionIndex += 1
    this.cursor = 0
    this.detailOffset = 0
    this.selected = new Set()
    this.custom = undefined
    this.customMode = false
    this.error = undefined
    if ((this.current().options?.length ?? 0) === 0) this.enterCustomMode()
  }

  private activateCurrent(): void {
    const question = this.current()
    const entry = this.entries()[this.cursor]
    if (entry === undefined) { this.enterCustomMode(); return }
    if (entry.kind === 'other') { this.enterCustomMode(); return }
    if (entry.kind === 'continue') {
      if (this.selected.size === 0 && this.custom === undefined) {
        this.error = 'Select at least one option or enter a custom answer.'
        return
      }
      this.completeCurrent({
        id: question.id,
        selected: [...this.selected],
        ...(this.custom === undefined ? {} : { custom: this.custom }),
      })
      return
    }
    if (question.multiSelect === true) {
      if (this.selected.has(entry.label)) this.selected.delete(entry.label)
      else this.selected.add(entry.label)
      this.error = undefined
      return
    }
    this.completeCurrent({ id: question.id, selected: [entry.label] })
  }

  private renderDetail(width: number): string[] {
    const detail = this.current().detail
    if (detail === undefined || detail === '') return []
    const all = new Markdown(detail, 0, 0, DETAIL_MARKDOWN_THEME).render(width)
    const maxOffset = Math.max(0, all.length - DETAIL_PAGE_LINES)
    this.detailOffset = Math.max(0, Math.min(this.detailOffset, maxOffset))
    const visible = all.slice(this.detailOffset, this.detailOffset + DETAIL_PAGE_LINES).map(line => fit(line, width))
    if (all.length > DETAIL_PAGE_LINES) {
      const label = this.current().intent?.kind === 'plan-review' ? 'Plan' : 'Detail'
      visible.push(theme.dim(`${label} ${this.detailOffset + 1}–${Math.min(all.length, this.detailOffset + DETAIL_PAGE_LINES)}/${all.length} · PgUp/PgDn scroll`))
    }
    return visible
  }

  private optionLabel(entry: QuestionEntry, active: boolean): string {
    let body: string
    if (entry.kind === 'option') {
      const mark = this.current().multiSelect === true ? `[${this.selected.has(entry.label) ? 'x' : ' '}] ` : ''
      body = `${mark}${entry.label}`
    } else if (entry.kind === 'other') {
      body = this.custom === undefined ? 'Type an answer…' : `Custom: ${this.custom}`
    } else {
      body = 'Continue'
    }
    return active ? theme.selected(`→ ${body}`) : `  ${body}`
  }

  /** Render the editable custom value in the exact row occupied by its placeholder. */
  private customInputRow(width: number): string {
    if (width <= 0) return ''
    const prefix = theme.selected('→ ')
    const available = Math.max(0, width - visibleWidth(prefix))
    if (available === 0) return fit(prefix, width)
    // pi-tui Input owns horizontal scrolling and cursor/IME placement. Remove
    // its built-in `> ` prompt because this selector row already has an arrow.
    const rendered = this.customInput.render(available + 2)[0] ?? ''
    const withoutPrompt = rendered.startsWith('> ') ? rendered.slice(2) : rendered
    return prefix + fit(withoutPrompt, available)
  }

  /** Keep a fixed description/error slot so moving onto custom never shifts the panel. */
  private descriptionLines(width: number, highlighted: QuestionEntry | undefined): string[] {
    const descriptions = (this.current().options ?? [])
      .map(option => option.description)
      .filter((value): value is string => value !== undefined && value !== '')
    const slots = Math.max(1, ...descriptions.map(value => Math.min(2, wrap(value, width).length)))
    let content: string[] = []
    if (this.error !== undefined) {
      content = wrap(theme.error(this.error), width).slice(0, slots)
    } else if (highlighted?.kind === 'option') {
      const description = this.current().options?.find(option => option.label === highlighted.label)?.description
      if (description !== undefined) content = wrap(theme.dim(description), width).slice(0, slots)
    }
    return [...content, ...Array.from({ length: Math.max(0, slots - content.length) }, () => '')]
  }

  private interactionHint(question: AskUserQuestionItem): string {
    const scroll = question.detail === undefined
      ? ''
      : ` · PgUp/PgDn ${question.intent?.kind === 'plan-review' ? 'plan' : 'detail'}`
    if (this.customMode) {
      const escapeAction = (question.options?.length ?? 0) === 0 ? 'Esc cancel' : 'Esc back'
      const submit = question.multiSelect === true ? 'Enter save' : 'Enter confirm'
      return `${submit}${scroll} · ${escapeAction}`
    }
    return question.multiSelect === true
      ? `↑↓ move · Space toggle · Enter choose/continue${scroll} · Esc cancel`
      : `↑↓ select · Enter confirm${scroll} · Esc cancel`
  }

  render(width: number): string[] {
    if (width <= 0) return []
    const question = this.current()
    const planReview = question.intent?.kind === 'plan-review'
    const heading = question.header ?? (planReview ? 'Plan review' : 'Question')
    const lines: string[] = [
      border(width),
      fit(`${theme.accent(`${heading} ${this.questionIndex + 1}/${this.questions.length}`)}`, width),
      ...wrap(theme.bold(question.question), width),
      ...this.renderDetail(width),
    ]

    const entries = this.entries()
    if (entries.length === 0) {
      lines.push(this.customInputRow(width))
      lines.push(...this.descriptionLines(width, undefined))
    } else {
      const start = Math.max(0, Math.min(this.cursor - Math.floor(OPTION_PAGE_LINES / 2), entries.length - OPTION_PAGE_LINES))
      for (let index = start; index < Math.min(entries.length, start + OPTION_PAGE_LINES); index += 1) {
        const entry = entries[index]
        if (entry === undefined) continue
        const active = index === this.cursor
        lines.push(this.customMode && active && entry.kind === 'other'
          ? this.customInputRow(width)
          : fit(this.optionLabel(entry, active), width))
      }
      const highlighted = entries[this.cursor]
      lines.push(...this.descriptionLines(width, highlighted))
    }
    lines.push(theme.dim(this.interactionHint(question)))
    lines.push(border(width))
    return lines.map(line => fit(line, width))
  }

  handleInput(data: string): void {
    if (this.customMode) { this.customInput.handleInput(data); return }
    if (matchesKey(data, 'up')) { this.move(-1); return }
    if (matchesKey(data, 'down')) { this.move(1); return }
    if (matchesKey(data, 'pageUp')) { this.detailOffset = Math.max(0, this.detailOffset - DETAIL_PAGE_LINES); return }
    if (matchesKey(data, 'pageDown')) { this.detailOffset += DETAIL_PAGE_LINES; return }
    if (matchesKey(data, 'space') && this.current().multiSelect === true) {
      if (this.entries()[this.cursor]?.kind === 'option') this.activateCurrent()
      return
    }
    if (matchesKey(data, 'enter')) { this.activateCurrent(); return }
    if (matchesKey(data, 'escape')) this.onCancel()
  }
}

/** Test/helper predicate for terminal-safe interaction output. */
export function interactionLinesFit(lines: readonly string[], width: number): boolean {
  return lines.every(line => visibleWidth(line) <= width)
}
