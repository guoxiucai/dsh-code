/**
 * Full-screen pi-tui session picker for `dsh-code -r`/`--resume`. Lists the
 * project's (or every project's) persisted sessions — each shown by its first
 * user message — with keyword search, keyboard navigation, deletion, and a
 * current-folder / all-folder scope toggle. Resolves to a session id to resume
 * or to an explicit exit (never falls through to a fresh session).
 * @module dsh-code/bootstrap/resume-picker
 */

import {
  Input,
  ProcessTerminal,
  TuiMainScreen,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui'
import { homedir } from 'node:os'
import { sep } from 'node:path'
import { bindAdaptiveTheme, theme, type AdaptiveThemeBinding } from '../tui/theme.ts'
import { deleteSession, listAllSessions, listProjectSessions, type ProjectSession } from './sessions.ts'

/** The picker's resolution: resume a session id, or leave without resuming. */
export type ResumePickerResult = { kind: 'resume'; id: string } | { kind: 'exit' }

const HINT = '[Del/@delete • Enter select • Tab all projects • Esc cancel]'

/** Max list rows rendered; the list scrolls when longer. */
const MAX_VISIBLE = 12

/** Compact relative age: `now`, `Xm`, `Xh`, `Xd Yh`, then `Xw`. */
function relativeAge(now: number, then: number): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ${hours % 24}h`
  return `${Math.floor(days / 7)}w`
}

/** Collapse the user's home-directory prefix to `~` for a project path. */
function abbreviatePath(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const home = homedir()
  if (cwd === home) return '~'
  if (cwd.startsWith(home + sep)) return `~${cwd.slice(home.length)}`
  return cwd
}

/** The picker surface: header, hint, search line, and the session list. */
class ResumePickerScreen implements Component {
  private readonly input = new Input()
  private readonly home: string
  private readonly cwd: string
  private readonly resolve: (result: ResumePickerResult) => void
  private scope: 'current' | 'all' = 'current'
  private entries: ProjectSession[] = []
  private filtered: ProjectSession[] = []
  private selectedIndex = 0
  /** True while the delete confirmation prompt is armed. */
  private pendingDelete = false

  constructor(home: string, cwd: string, resolve: (result: ResumePickerResult) => void) {
    this.home = home
    this.cwd = cwd
    this.resolve = resolve
    this.reload()
  }

  /** Focus passthrough: the Input owns the hardware cursor for IME. */
  get focused(): boolean { return this.input.focused }
  set focused(value: boolean) { this.input.focused = value }

  private reload(): void {
    this.entries = this.scope === 'current'
      ? listProjectSessions(this.home, this.cwd)
      : listAllSessions(this.home)
    this.applyFilter()
  }

  private applyFilter(): void {
    const query = this.input.getValue().trim().toLowerCase()
    this.filtered = query === ''
      ? this.entries
      : this.entries.filter(entry => entry.title.toLowerCase().includes(query))
    if (this.selectedIndex >= this.filtered.length) this.selectedIndex = Math.max(0, this.filtered.length - 1)
  }

  private toggleScope(): void {
    this.scope = this.scope === 'current' ? 'all' : 'current'
    this.selectedIndex = 0
    this.reload()
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return
    this.selectedIndex = (this.selectedIndex + delta + this.filtered.length) % this.filtered.length
  }

  private selectCurrent(): void {
    const entry = this.filtered[this.selectedIndex]
    if (entry !== undefined) this.resolve({ kind: 'resume', id: entry.id })
  }

  /** Arm the delete confirmation for the currently selected session. */
  private beginDelete(): void {
    if (this.filtered[this.selectedIndex] === undefined) return
    this.pendingDelete = true
  }

  /** Perform the confirmed deletion and clear the confirmation state. */
  private confirmDelete(): void {
    this.pendingDelete = false
    const entry = this.filtered[this.selectedIndex]
    if (entry === undefined) return
    if (!deleteSession(entry.dir)) {
      process.stderr.write(`dsh-code: failed to delete session ${entry.id}\n`)
      return
    }
    this.entries = this.entries.filter(candidate => candidate.dir !== entry.dir)
    this.applyFilter()
  }

  handleInput(data: string): void {
    if (this.pendingDelete) {
      if (matchesKey(data, 'enter')) { this.confirmDelete(); return }
      if (matchesKey(data, 'escape')) {
        this.pendingDelete = false
      }
      if (matchesKey(data, 'ctrl+c')) return
      return
    }
    if (matchesKey(data, 'escape')) {
      this.resolve({ kind: 'exit' })
      return
    }
    if (matchesKey(data, 'ctrl+c')) return
    if (matchesKey(data, 'tab')) { this.toggleScope(); return }
    if (matchesKey(data, 'delete')) { this.beginDelete(); return }
    if (matchesKey(data, 'backspace') && this.input.getValue() === '') { this.beginDelete(); return }
    if (matchesKey(data, 'up')) { this.move(-1); return }
    if (matchesKey(data, 'down')) { this.move(1); return }
    if (matchesKey(data, 'enter')) { this.selectCurrent(); return }
    this.input.handleInput(data)
    this.applyFilter()
  }

  invalidate(): void { this.input.invalidate() }

  render(width: number): string[] {
    const border = theme.dim('─'.repeat(Math.max(1, width)))
    const header = this.scope === 'current' ? 'Resume Session (Current Folder)' : 'Resume Session (All Folder)'
    const hint = this.pendingDelete
      ? `${theme.darkRed('Delete session?')} ${theme.dim('enter confirm · escape cancel')}`
      : theme.dim(HINT)
    const searchLine = this.input.render(width)[0] ?? ''
    return [border, header, hint, searchLine, ...this.listLines(width), border]
  }

  private listLines(width: number): string[] {
    if (this.filtered.length === 0) return [theme.dim('  No sessions')]
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE / 2), this.filtered.length - MAX_VISIBLE))
    const end = Math.min(start + MAX_VISIBLE, this.filtered.length)
    const now = Date.now()
    const lines: string[] = []
    for (let index = start; index < end; index++) {
      const entry = this.filtered[index]
      if (entry !== undefined) lines.push(this.itemLine(width, entry, index === this.selectedIndex, now))
    }
    return lines
  }

  private itemLine(width: number, entry: ProjectSession, selected: boolean, now: number): string {
    const time = entry.createdAt === undefined ? '' : relativeAge(now, entry.createdAt)
    const description = this.scope === 'all' ? this.describeAllFolder(entry, time) : time
    const title = entry.title === '' ? '(no messages)' : entry.title
    const titleMax = Math.max(1, width - 3 - visibleWidth(description))
    const truncatedTitle = truncateToWidth(title, titleMax, '')
    const padding = ' '.repeat(Math.max(0, titleMax - visibleWidth(truncatedTitle)) + 1)
    if (selected) {
      const line = `› ${truncatedTitle}${padding}${description}`
      return this.pendingDelete ? theme.darkRed(line) : theme.selected(line)
    }
    return `  ${truncatedTitle}${padding}${description === '' ? '' : theme.dim(description)}`
  }

  /** Right-side description: abbreviated project path plus age (All Folder). */
  private describeAllFolder(entry: ProjectSession, time: string): string {
    const path = abbreviatePath(entry.cwd)
    if (path === '') return time
    return time === '' ? path : `${path} ${time}`
  }
}

/** Open the picker and resolve the chosen session id, or an explicit exit. */
export function pickSession(home: string, cwd: string): Promise<ResumePickerResult> {
  return new Promise((resolve) => {
    let adaptiveTheme: AdaptiveThemeBinding | undefined
    try {
      const tui: TUI = new TuiMainScreen(new ProcessTerminal())
      const screen = new ResumePickerScreen(home, cwd, (result) => {
        adaptiveTheme?.dispose()
        try { tui.stop() } catch { /* already stopped */ }
        resolve(result)
      })
      tui.addChild(screen)
      tui.setFocus(screen)
      tui.start()
      adaptiveTheme = bindAdaptiveTheme(tui)
      void adaptiveTheme.detect()
    } catch {
      adaptiveTheme?.dispose()
      resolve({ kind: 'exit' })
    }
  })
}
