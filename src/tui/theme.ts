/**
 * Adaptive ANSI color palette for the terminal transcript. Brand and block
 * colors track the terminal's dark/light preference; every role remains an
 * identity under `NO_COLOR`.
 * @module dsh-code/tui/theme
 */

import type { RgbColor, TerminalColorScheme, TUI } from '@earendil-works/pi-tui'

const ENABLED = process.env.NO_COLOR === undefined

interface ThemePalette {
  accent: string
  userBg: string
  toolBg: string
  diffAddedBg: string
  diffRemovedBg: string
}

/** Same DeepSeek-blue hue, tuned separately for dark and light terminals. */
export const THEME_PALETTES: Readonly<Record<TerminalColorScheme, ThemePalette>> = {
  dark: {
    accent: '107;132;255',
    userBg: '52;53;65',
    toolBg: '40;50;40',
    diffAddedBg: '29;63;42',
    diffRemovedBg: '74;35;35',
  },
  light: {
    accent: '64;91;216',
    userBg: '238;241;255',
    toolBg: '239;247;240',
    diffAddedBg: '218;242;225',
    diffRemovedBg: '250;218;218',
  },
}

let colorScheme: TerminalColorScheme = 'dark'

/** Switch the active palette; returns whether rendered colors changed. */
export function setThemeColorScheme(next: TerminalColorScheme): boolean {
  if (colorScheme === next) return false
  colorScheme = next
  return true
}

export function getThemeColorScheme(): TerminalColorScheme { return colorScheme }

/** Classify an OSC 11 background response when scheme DSR is unavailable. */
export function colorSchemeForBackground({ r, g, b }: RgbColor): TerminalColorScheme {
  const perceivedBrightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return perceivedBrightness >= 0.5 ? 'light' : 'dark'
}

/** A live role resolves its ANSI opening sequence at render/call time. */
function adaptivePaint(open: () => string, close: string): (text: string) => string {
  if (!ENABLED) return text => text
  return text => `\x1b[${open()}m${text}\x1b[${close}m`
}

/** Build a color/attribute role function (identity when color is disabled). */
function paint(open: string, close: string): (text: string) => string {
  if (!ENABLED) return text => text
  return text => `\x1b[${open}m${text}\x1b[${close}m`
}

const brand = adaptivePaint(() => `38;2;${THEME_PALETTES[colorScheme].accent}`, '39')
const selected = adaptivePaint(() => `1;38;2;${THEME_PALETTES[colorScheme].accent}`, '22;39')
const userBg = adaptivePaint(() => `48;2;${THEME_PALETTES[colorScheme].userBg}`, '49')
const toolBg = adaptivePaint(() => `48;2;${THEME_PALETTES[colorScheme].toolBg}`, '49')
const diffAddedBg = adaptivePaint(() => `48;2;${THEME_PALETTES[colorScheme].diffAddedBg}`, '49')
const diffRemovedBg = adaptivePaint(() => `48;2;${THEME_PALETTES[colorScheme].diffRemovedBg}`, '49')

export interface AdaptiveThemeBinding {
  /** Query the initial preference after the terminal has started. */
  detect(): Promise<void>
  dispose(): void
}

/**
 * Follow terminal palette notifications and trigger a full UI recolor. Call
 * `detect()` only after `tui.start()` so the terminal can answer the query.
 */
export function bindAdaptiveTheme(tui: TUI, onChange?: () => void): AdaptiveThemeBinding {
  let disposed = false
  const apply = (scheme: TerminalColorScheme): void => {
    if (disposed || !setThemeColorScheme(scheme)) return
    onChange?.()
    tui.invalidate()
    tui.requestRender(true)
  }
  const unsubscribe = tui.onTerminalColorSchemeChange(apply)
  tui.setTerminalColorSchemeNotifications(true)
  return {
    detect: async () => {
      const preferred = await tui.queryTerminalColorScheme({ timeoutMs: 150 })
      if (preferred !== undefined) {
        apply(preferred)
        return
      }
      // OSC 11 is supported by many terminals that do not implement palette
      // preference DSR, so use the actual background as a broad fallback.
      const background = await tui.queryTerminalBackgroundColor({ timeoutMs: 150 })
      if (background !== undefined) apply(colorSchemeForBackground(background))
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      tui.setTerminalColorSchemeNotifications(false)
    },
  }
}

/** The transcript palette: one role per semantic kind of content. */
export const theme = {
  /** Body text — the terminal default foreground. */
  text: (text: string): string => text,
  /** Recessed tone: tool arguments, notices, footers. */
  dim: paint('2;39', '22;39'),
  /** Primary brand emphasis: role headers, prompts, status, and active markers. */
  accent: brand,
  /** Code / inline-code tone. */
  code: paint('36', '39'),
  /** Succeeded calls. */
  success: paint('32', '39'),
  /** Pending calls and warnings. */
  warning: paint('33', '39'),
  /** Failures. */
  error: paint('31', '39'),
  /** Pending-deletion confirmation (dark red #8b0000). */
  darkRed: paint('38;2;139;0;0', '39'),
  bold: paint('1', '22'),
  /** Reasoning text. */
  italic: paint('3', '23'),
  /** Bold DeepSeek blue for active rows (stable across terminal backgrounds). */
  selected,
  /** Full-width user-message background: dark slate or light blue-gray. */
  userBg,
  /** Full-width tool-call background: dark green-gray or light green-gray. */
  toolBg,
  /** Full-width added-code background: dark green or light green tint. */
  diffAddedBg,
  /** Full-width removed-code background: dark red or light red tint. */
  diffRemovedBg,
  /** Default editor border — adaptive DeepSeek brand blue. */
  border: brand,
  /** Editor border color in shell mode (`!` prefix) — a distinct green. */
  bashBorder: paint('38;2;166;218;149', '39'),
  /** Inline selector/input border — the same DeepSeek brand blue. */
  selectorBorder: brand,
  /** Welcome whale — adaptive but hue-compatible with the primary brand. */
  whale: brand,
}
