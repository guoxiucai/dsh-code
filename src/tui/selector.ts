/**
 * Inline list selector (pi-style model/permission picker): a bordered block with
 * a single-line search input and keyboard navigation, mounted inline in the
 * transcript rather than as a full-screen overlay.
 * @module dsh-code/tui/selector
 */

import { Container, Input, Key, Text, matchesKey, type Component, type Focusable } from '@earendil-works/pi-tui'
import { theme } from './theme.ts'

/** A full-width colored border line. */
class SelectorBorder implements Component {
  constructor(private readonly color: (text: string) => string) {}
  invalidate(): void {}
  render(width: number): string[] {
    return [this.color('─'.repeat(Math.max(1, width)))]
  }
}

/** One selectable entry. */
export interface SelectorItem {
  value: string
  label: string
  description?: string
  /** Mark the current selection with a ✓. */
  current?: boolean
}

/** Selector construction options. */
export interface SelectorOptions {
  hint: string
  items: SelectorItem[]
  borderColor: (text: string) => string
  onSelect: (value: string) => void
  onCancel: () => void
}

/** Inline single-line input options, used by multi-step terminal wizards. */
export interface InlineTextInputOptions {
  prompt: string
  hint?: string
  initialValue?: string | undefined
  borderColor: (text: string) => string
  onSubmit: (value: string) => void
  onCancel: () => void
}

/** A bordered inline text field with Enter-to-submit and Esc-to-go-back. */
export class InlineTextInputComponent extends Container implements Focusable {
  private readonly input = new Input()
  private _focused = false

  constructor(options: InlineTextInputOptions) {
    super()
    this.addChild(new SelectorBorder(options.borderColor))
    this.addChild(new Text(options.prompt, 0, 0))
    this.addChild(new Text(theme.dim(options.hint ?? 'Enter to continue · Esc to go back'), 0, 0))
    if (options.initialValue !== undefined && options.initialValue !== '') {
      this.input.setValue(options.initialValue)
      // Input#setValue preserves its cursor; a new input starts at column zero.
      this.input.handleInput('\x05')
    }
    this.input.onSubmit = (value) => {
      const trimmed = value.trim()
      if (trimmed !== '') options.onSubmit(trimmed)
    }
    this.input.onEscape = options.onCancel
    this.addChild(this.input)
    this.addChild(new SelectorBorder(options.borderColor))
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value; this.input.focused = value }

  handleInput(data: string): void { this.input.handleInput(data) }
}

/** An inline list selector with search and keyboard navigation. */
export class ListSelectorComponent extends Container implements Focusable {
  private readonly searchInput: Input
  private readonly listContainer: Container
  private readonly items: SelectorItem[]
  private filtered: SelectorItem[]
  private selectedIndex = 0
  private readonly options: SelectorOptions
  private _focused = false

  constructor(options: SelectorOptions) {
    super()
    this.options = options
    this.items = options.items
    this.filtered = [...options.items]
    this.addChild(new SelectorBorder(options.borderColor))
    if (options.hint !== '') this.addChild(new Text(theme.dim(options.hint), 0, 0))
    this.searchInput = new Input()
    this.searchInput.onSubmit = () => { this.selectCurrent() }
    this.addChild(this.searchInput)
    this.listContainer = new Container()
    this.addChild(this.listContainer)
    this.addChild(new SelectorBorder(options.borderColor))
    this.updateList()
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value; this.searchInput.focused = value }

  private selectCurrent(): void {
    const item = this.filtered[this.selectedIndex]
    if (item !== undefined) this.options.onSelect(item.value)
  }

  private filter(query: string): void {
    this.filtered = query === ''
      ? [...this.items]
      : this.items.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
    this.selectedIndex = query === '' ? Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1)) : 0
    this.updateList()
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return
    this.selectedIndex = (this.selectedIndex + delta + this.filtered.length) % this.filtered.length
    this.updateList()
  }

  private updateList(): void {
    this.listContainer.clear()
    if (this.filtered.length === 0) {
      this.listContainer.addChild(new Text(theme.dim('  No matching items'), 0, 0))
      return
    }
    const maxVisible = 10
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filtered.length - maxVisible))
    const end = Math.min(start + maxVisible, this.filtered.length)
    for (let index = start; index < end; index++) {
      const item = this.filtered[index]
      if (item === undefined) continue
      const isSelected = index === this.selectedIndex
      const label = isSelected ? theme.selected(`→ ${item.label}`) : `  ${item.label}`
      const check = item.current === true ? theme.accent(' ✓') : ''
      this.listContainer.addChild(new Text(`${label}${check}`, 0, 0))
    }
    const selected = this.filtered[this.selectedIndex]
    if (selected?.description !== undefined) {
      this.listContainer.addChild(new Text(theme.dim(`  ${selected.description}`), 0, 0))
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'up')) { this.move(-1); return }
    if (matchesKey(data, 'down')) { this.move(1); return }
    if (matchesKey(data, 'escape') || matchesKey(data, Key.ctrl('c'))) { this.options.onCancel(); return }
    this.searchInput.handleInput(data)
    this.filter(this.searchInput.getValue())
  }

  override invalidate(): void {
    // Selected/current labels contain the palette's concrete ANSI sequence.
    this.updateList()
    super.invalidate()
  }
}
