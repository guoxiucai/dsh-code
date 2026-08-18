/**
 * ANSI color palette for the terminal transcript. Each role wraps text in its
 * escape sequence; every role is identity under `NO_COLOR` so the transcript
 * stays readable on a colorless terminal. Mirrors the pi/old-dsh role palette.
 * @module dsh-code/tui/theme
 */

const ENABLED = process.env.NO_COLOR === undefined

/** DeepSeek whale/brand blue (#4d6bfe), shared by every primary UI accent. */
const DEEPSEEK_BLUE = '38;2;77;107;254'

/** Build a color/attribute role function (identity when color is disabled). */
function paint(open: string, close: string): (text: string) => string {
  if (!ENABLED) return text => text
  return text => `\x1b[${open}m${text}\x1b[${close}m`
}

const brand = paint(DEEPSEEK_BLUE, '39')
const selected = paint(`1;${DEEPSEEK_BLUE}`, '22;39')

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
  /** Full-width background for the user-message block (#343541). */
  userBg: paint('48;2;52;53;65', '49'),
  /** Full-width background for the tool-call block (#283228). */
  toolBg: paint('48;2;40;50;40', '49'),
  /** Default editor border — DeepSeek brand blue (#4d6bfe). */
  border: brand,
  /** Editor border color in shell mode (`!` prefix) — a distinct green. */
  bashBorder: paint('38;2;166;218;149', '39'),
  /** Inline selector/input border — the same DeepSeek brand blue. */
  selectorBorder: brand,
  /** Welcome whale — the source of the product's primary color. */
  whale: brand,
}
