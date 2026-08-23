/**
 * Inline list selector (pi-style model/permission picker): a bordered block with
 * a single-line search input and keyboard navigation, mounted inline in the
 * transcript rather than as a full-screen overlay.
 * @module dsh-code/tui/selector
 */

import { Container, Input, Text, matchesKey, truncateToWidth, type Component, type Focusable } from '@earendil-works/pi-tui'
import { theme } from './theme.ts'
import type { SessionTreeRow } from './session-tree.ts'

/** A full-width colored border line. */
class SelectorBorder implements Component {
  constructor(private readonly color: (text: string) => string) {}
  invalidate(): void {}
  render(width: number): string[] {
    return [this.color('─'.repeat(Math.max(1, width)))]
  }
}

/** One terminal row that cannot wrap and grow a bottom-pinned selector. */
class FittedText implements Component {
  constructor(private readonly text: string) {}
  invalidate(): void {}
  render(width: number): string[] {
    const singleLine = this.text.replace(/\r?\n/g, ' ')
    return width <= 0 ? [] : [truncateToWidth(singleLine, width, '…')]
  }
}

/** One selectable entry. */
export interface SelectorItem {
  value: string
  label: string
  description?: string
  /** Mark the current selection with a ✓. */
  current?: boolean
  /** Non-selectable section heading; retained when one of its items matches search. */
  selectable?: boolean
  /** Stable section key used to retain headings while filtering grouped lists. */
  section?: string
}

/** Selector construction options. */
export interface SelectorOptions {
  hint: string
  items: SelectorItem[]
  /** Optional initial search text, used by argument-bearing picker commands. */
  initialQuery?: string
  borderColor: (text: string) => string
  onSelect: (value: string) => void
  /** Optional Space action that keeps the selector open (for toggles). */
  onToggle?: (value: string) => void
  onCancel: () => void
}

/** Live selector handle used by status-driven panels such as /mcp. */
export interface SelectorHandle {
  updateItems(items: SelectorItem[]): void
}

export interface SessionTreeSelectorOptions {
  rows: readonly SessionTreeRow[]
  borderColor: (text: string) => string
  onSelect: (sessionId: string) => void
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

  handleInput(data: string): void {
    // Reserve Ctrl+C for terminal-native selection copy; only Esc goes back.
    if (matchesKey(data, 'ctrl+c')) return
    this.input.handleInput(data)
  }
}

/** An inline list selector with search and keyboard navigation. */
export class ListSelectorComponent extends Container implements Focusable {
  private readonly searchInput: Input
  private readonly listContainer: Container
  private items: SelectorItem[]
  private filtered: SelectorItem[]
  private selectedIndex = 0
  private readonly options: SelectorOptions
  private _focused = false

  constructor(options: SelectorOptions) {
    super()
    this.options = options
    this.items = options.items
    this.filtered = [...options.items]
    this.selectedIndex = this.firstSelectableIndex(this.filtered)
    this.addChild(new SelectorBorder(options.borderColor))
    if (options.hint !== '') this.addChild(new FittedText(theme.dim(options.hint)))
    this.searchInput = new Input()
    this.searchInput.onSubmit = () => { this.selectCurrent() }
    this.addChild(this.searchInput)
    this.listContainer = new Container()
    this.addChild(this.listContainer)
    this.addChild(new SelectorBorder(options.borderColor))
    if (options.initialQuery !== undefined && options.initialQuery !== '') {
      this.searchInput.setValue(options.initialQuery)
      this.searchInput.handleInput('\x05')
      this.filter(options.initialQuery)
    } else {
      this.updateList()
    }
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value; this.searchInput.focused = value }

  private selectCurrent(): void {
    const item = this.filtered[this.selectedIndex]
    if (item !== undefined && item.selectable !== false) this.options.onSelect(item.value)
  }

  private firstSelectableIndex(items: readonly SelectorItem[]): number {
    const index = items.findIndex(item => item.selectable !== false)
    return Math.max(0, index)
  }

  private filter(query: string): void {
    if (query === '') {
      this.filtered = [...this.items]
    } else {
      const normalized = query.toLowerCase()
      const matchingSections = new Set(this.items
        .filter(item => item.selectable !== false && `${item.label} ${item.description ?? ''}`.toLowerCase().includes(normalized))
        .map(item => item.section)
        .filter((section): section is string => section !== undefined))
      this.filtered = this.items.filter(item => item.selectable === false
        ? item.section !== undefined && matchingSections.has(item.section)
        : `${item.label} ${item.description ?? ''}`.toLowerCase().includes(normalized))
    }
    const selected = this.filtered[this.selectedIndex]
    if (query !== '' || selected?.selectable === false || selected === undefined) {
      this.selectedIndex = this.firstSelectableIndex(this.filtered)
    } else {
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1))
    }
    this.updateList()
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return
    let next = this.selectedIndex
    for (let attempts = 0; attempts < this.filtered.length; attempts += 1) {
      next = (next + delta + this.filtered.length) % this.filtered.length
      if (this.filtered[next]?.selectable !== false) {
        this.selectedIndex = next
        break
      }
    }
    this.updateList()
  }

  private updateList(): void {
    this.listContainer.clear()
    if (this.filtered.length === 0) {
      this.listContainer.addChild(new FittedText(theme.dim('  No matching items')))
      return
    }
    const maxVisible = 10
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filtered.length - maxVisible))
    const end = Math.min(start + maxVisible, this.filtered.length)
    for (let index = start; index < end; index++) {
      const item = this.filtered[index]
      if (item === undefined) continue
      const isSelected = index === this.selectedIndex && item.selectable !== false
      const label = item.selectable === false
        ? theme.bold(item.label)
        : isSelected ? theme.selected(`→ ${item.label}`) : `  ${item.label}`
      const check = item.current === true ? theme.accent(' ✓') : ''
      this.listContainer.addChild(new FittedText(`${label}${check}`))
    }
    const selected = this.filtered[this.selectedIndex]
    if (selected?.description !== undefined) {
      this.listContainer.addChild(new FittedText(theme.dim(`  ${selected.description}`)))
    }
  }

  /** Replace labels/statuses without losing the current query or selected value. */
  updateItems(items: SelectorItem[]): void {
    const selectedValue = this.filtered[this.selectedIndex]?.value
    this.items = [...items]
    this.filter(this.searchInput.getValue())
    if (selectedValue !== undefined) {
      const index = this.filtered.findIndex(item => item.value === selectedValue && item.selectable !== false)
      if (index >= 0) this.selectedIndex = index
    }
    this.updateList()
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'up')) { this.move(-1); return }
    if (matchesKey(data, 'down')) { this.move(1); return }
    if (matchesKey(data, 'escape')) { this.options.onCancel(); return }
    if (matchesKey(data, 'space') && this.options.onToggle !== undefined) {
      const item = this.filtered[this.selectedIndex]
      if (item !== undefined && item.selectable !== false) this.options.onToggle(item.value)
      this.updateList()
      return
    }
    if (matchesKey(data, 'ctrl+c')) return
    this.searchInput.handleInput(data)
    this.filter(this.searchInput.getValue())
  }

  override invalidate(): void {
    // Selected/current labels contain the palette's concrete ANSI sequence.
    this.updateList()
    super.invalidate()
  }
}

/** A searchable, collapsible inline session-lineage selector inspired by pi. */
export class SessionTreeSelectorComponent extends Container implements Focusable {
  private readonly searchInput = new Input()
  private readonly listContainer = new Container()
  private readonly collapsed = new Set<string>()
  private visible: SessionTreeRow[] = []
  private selectedIndex = 0
  private _focused = false

  constructor(private readonly options: SessionTreeSelectorOptions) {
    super()
    this.addChild(new SelectorBorder(options.borderColor))
    this.addChild(new FittedText(theme.dim('Session tree · Enter switch · ←/→ fold · Esc close')))
    this.addChild(new FittedText(theme.warning('Switching conversation does not revert workspace files.')))
    this.searchInput.onSubmit = () => { this.selectCurrent() }
    this.addChild(this.searchInput)
    this.addChild(this.listContainer)
    this.addChild(new SelectorBorder(options.borderColor))
    this.rebuildVisible()
    const currentIndex = this.visible.findIndex(row => row.current)
    if (currentIndex >= 0) this.selectedIndex = currentIndex
    this.updateList()
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value; this.searchInput.focused = value }

  private matchingIds(query: string): Set<string> | undefined {
    const normalized = query.trim().toLowerCase()
    if (normalized === '') return undefined
    const byId = new Map(this.options.rows.map(row => [row.id, row]))
    const included = new Set<string>()
    for (const row of this.options.rows) {
      const timestamp = new Date(row.createdAt).toLocaleString()
      if (!`${row.title} ${row.id} ${timestamp}`.toLowerCase().includes(normalized)) continue
      let cursor: SessionTreeRow | undefined = row
      while (cursor !== undefined && !included.has(cursor.id)) {
        included.add(cursor.id)
        cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId)
      }
    }
    return included
  }

  private rebuildVisible(): void {
    const matches = this.matchingIds(this.searchInput.getValue())
    const hiddenDepths: number[] = []
    this.visible = this.options.rows.filter((row) => {
      while (hiddenDepths.length > 0 && row.depth <= (hiddenDepths.at(-1) ?? -1)) hiddenDepths.pop()
      const hidden = hiddenDepths.length > 0
      if (matches === undefined && this.collapsed.has(row.id)) hiddenDepths.push(row.depth)
      return !hidden && (matches === undefined || matches.has(row.id))
    })
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.visible.length - 1))
  }

  private prefix(row: SessionTreeRow): string {
    const guides = row.guides.map(continued => continued ? '│  ' : '   ').join('')
    const branch = row.depth === 0 ? '' : row.lastSibling ? '└─ ' : '├─ '
    const folded = row.hasChildren ? (this.collapsed.has(row.id) ? '▸ ' : '▾ ') : '  '
    return `${guides}${branch}${folded}`
  }

  private updateList(): void {
    this.listContainer.clear()
    if (this.visible.length === 0) {
      this.listContainer.addChild(new FittedText(theme.dim('  No matching sessions')))
      return
    }
    const maxVisible = 12
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.visible.length - maxVisible))
    const end = Math.min(start + maxVisible, this.visible.length)
    for (let index = start; index < end; index += 1) {
      const row = this.visible[index]
      if (row === undefined) continue
      const marker = index === this.selectedIndex ? '→ ' : '  '
      const current = row.current ? ' ✓ current' : ''
      const availability = row.persisted ? '' : ' · live only'
      const line = `${marker}${this.prefix(row)}${row.title}${current}${availability}`
      this.listContainer.addChild(new FittedText(
        index === this.selectedIndex
          ? theme.selected(line)
          : row.activePath ? theme.accent(line) : line,
      ))
    }
    const selected = this.visible[this.selectedIndex]
    if (selected !== undefined) {
      this.listContainer.addChild(new FittedText(theme.dim(
        `  ${selected.id} · ${new Date(selected.createdAt).toLocaleString()}`,
      )))
    }
  }

  private move(delta: number): void {
    if (this.visible.length === 0) return
    this.selectedIndex = (this.selectedIndex + delta + this.visible.length) % this.visible.length
    this.updateList()
  }

  private selectCurrent(): void {
    const row = this.visible[this.selectedIndex]
    if (row !== undefined) this.options.onSelect(row.id)
  }

  private foldCurrent(collapse: boolean): void {
    const row = this.visible[this.selectedIndex]
    if (row === undefined) return
    if (collapse) {
      if (row.hasChildren && !this.collapsed.has(row.id)) this.collapsed.add(row.id)
      else if (row.parentId !== undefined) {
        const parentIndex = this.visible.findIndex(candidate => candidate.id === row.parentId)
        if (parentIndex >= 0) this.selectedIndex = parentIndex
      }
    } else if (row.hasChildren) {
      this.collapsed.delete(row.id)
    }
    this.rebuildVisible()
    this.updateList()
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'up')) { this.move(-1); return }
    if (matchesKey(data, 'down')) { this.move(1); return }
    if (matchesKey(data, 'pageUp')) { this.move(-10); return }
    if (matchesKey(data, 'pageDown')) { this.move(10); return }
    if (matchesKey(data, 'left')) { this.foldCurrent(true); return }
    if (matchesKey(data, 'right')) { this.foldCurrent(false); return }
    if (matchesKey(data, 'escape')) {
      if (this.searchInput.getValue() !== '') {
        this.searchInput.setValue('')
        this.rebuildVisible()
        this.updateList()
      } else this.options.onCancel()
      return
    }
    if (matchesKey(data, 'ctrl+c')) return
    this.searchInput.handleInput(data)
    this.rebuildVisible()
    this.updateList()
  }

  override invalidate(): void {
    this.updateList()
    super.invalidate()
  }
}
