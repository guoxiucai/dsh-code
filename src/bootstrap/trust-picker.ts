/**
 * Interactive first-trust selection: a full-screen pi-tui list. Choosing a
 * permission preset resolves `trust`; "Quit" or Esc/Ctrl+C resolves `reject`
 * (fail-closed — no project code loads without a positive answer).
 * @module dsh-code/bootstrap/trust-picker
 */

import {
  Key,
  ProcessTerminal,
  TuiMainScreen,
  matchesKey,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui'
import { bindAdaptiveTheme, theme, type AdaptiveThemeBinding } from '../tui/theme.ts'
import type { PermissionPreset } from './trust.ts'

/** The picker's resolution: trust with a preset, or leave untrusted. */
export type TrustPickerResult = { kind: 'trust'; preset: PermissionPreset } | { kind: 'reject' }

/** The three trust levels in the order presented (Workspace is the default). */
const PRESETS: ReadonlyArray<{ preset: PermissionPreset; label: string; description: string }> = [
  { preset: 'workspace-write', label: 'Workspace', description: 'allow writes inside the project (default)' },
  { preset: 'read-only', label: 'Read Only', description: 'refuse file writes (reads/network are not sandboxed)' },
  { preset: 'danger-full-access', label: 'Full Access', description: 'bypass the filesystem sandbox' },
]

/** Width each preset label is padded to, aligning the description column. */
const LABEL_WIDTH = 11

/** The full-screen first-trust selection surface. */
class TrustPickerScreen implements Component {
  private selectedIndex = 0
  private _focused = false
  private readonly projectPath: string
  private readonly resolve: (result: TrustPickerResult) => void

  constructor(projectPath: string, resolve: (result: TrustPickerResult) => void) {
    this.projectPath = projectPath
    this.resolve = resolve
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value }

  private choosePreset(index: number): void {
    const preset = PRESETS[index]?.preset
    if (preset !== undefined) this.resolve({ kind: 'trust', preset })
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, Key.ctrl('c')) || data === '4') {
      this.resolve({ kind: 'reject' })
      return
    }
    if (matchesKey(data, 'up')) { this.selectedIndex = (this.selectedIndex - 1 + 4) % 4; return }
    if (matchesKey(data, 'down')) { this.selectedIndex = (this.selectedIndex + 1) % 4; return }
    if (matchesKey(data, 'enter')) {
      if (this.selectedIndex === 3) this.resolve({ kind: 'reject' })
      else this.choosePreset(this.selectedIndex)
      return
    }
    if (data === '1') { this.selectedIndex = 0; this.choosePreset(0); return }
    if (data === '2') { this.selectedIndex = 1; this.choosePreset(1); return }
    if (data === '3') { this.selectedIndex = 2; this.choosePreset(2); return }
  }

  invalidate(): void {}

  render(_width: number): string[] {
    const lines: string[] = []
    lines.push(`Trust this project? ${this.projectPath}`)
    lines.push('')
    for (let index = 0; index < PRESETS.length; index++) {
      const preset = PRESETS[index]
      if (preset === undefined) continue
      const label = `${preset.label.padEnd(LABEL_WIDTH)} — ${preset.description}`
      const marker = index === this.selectedIndex ? theme.selected('❯') : ' '
      lines.push(`${marker} ${index + 1}. ${label}`)
    }
    const quitMarker = this.selectedIndex === 3 ? theme.selected('❯') : ' '
    lines.push(`${quitMarker} 4. Quit without trusting`)
    lines.push('')
    lines.push(theme.dim(' Enter to confirm · Esc to cancel'))
    return lines
  }
}

/** Open the trust picker and resolve the chosen preset, or a rejection. */
export function pickTrust(projectPath: string): Promise<TrustPickerResult> {
  return new Promise((resolve) => {
    let adaptiveTheme: AdaptiveThemeBinding | undefined
    try {
      const tui: TUI = new TuiMainScreen(new ProcessTerminal())
      const screen = new TrustPickerScreen(projectPath, (result) => {
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
      resolve({ kind: 'reject' })
    }
  })
}
