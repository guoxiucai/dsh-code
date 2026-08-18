/**
 * ANSI color palette for the terminal transcript. Each role wraps text in its
 * escape sequence; every role is identity under `NO_COLOR` so the transcript
 * stays readable on a colorless terminal. Mirrors the pi/old-dsh role palette.
 * @module dsh-code/tui/theme
 */

const ENABLED = process.env.NO_COLOR === undefined

/** Build a color/attribute role function (identity when color is disabled). */
function paint(open: string, close: string): (text: string) => string {
  if (!ENABLED) return text => text
  return text => `\x1b[${open}m${text}\x1b[${close}m`
}

/** The transcript palette: one role per semantic kind of content. */
export const theme = {
  /** Body text — the terminal default foreground. */
  text: (text: string): string => text,
  /** Recessed tone: tool arguments, notices, footers. */
  dim: paint('2;39', '22;39'),
  /** The one emphasis color: role headers, prompt, tool names. */
  accent: paint('95', '39'),
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
  /** Reverse video for the active selection. */
  selected: paint('7', '27'),
  /** Full-width background for the user-message block (#343541). */
  userBg: paint('48;2;52;53;65', '49'),
  /** Full-width background for the tool-call block (#283228). */
  toolBg: paint('48;2;40;50;40', '49'),
  /** Editor border color (#ca84db). */
  border: paint('38;2;202;132;219', '39'),
  /** Editor border color in shell mode (`!` prefix) — a distinct green. */
  bashBorder: paint('38;2;166;218;149', '39'),
  /** Inline selector border color (model/permission pickers). */
  selectorBorder: paint('38;2;137;180;250', '39'),
  /** DeepSeek brand blue (#4d6bfe) for the welcome whale. */
  whale: paint('38;2;77;107;254', '39'),
}
