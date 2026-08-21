import { describe, expect, it } from 'vitest'
import { stripTerminalSequences, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import {
  createMainViewportLayout,
  formatActivityDuration,
  halveBlockArt,
  isTurnInterruptInput,
  layoutStatusLine,
  renderDiffRow,
  renderDiffRows,
  renderReasoningLines,
  renderWorkingMessage,
  renderWelcomeBanner,
  renderStatus,
  renderTodoLines,
  renderTodoPanel,
  WELCOME_WHALE,
  WELCOME_WHALE_SOURCE,
} from '../../src/tui/host.ts'
import { theme } from '../../src/tui/theme.ts'
import { emptyViewModel } from '../../src/tui/view-model.ts'

describe('working activity', () => {
  it('formats elapsed time as seconds, minutes, and hours', () => {
    expect(formatActivityDuration(999)).toBe('0s')
    expect(formatActivityDuration(87_000)).toBe('1m 27s')
    expect(formatActivityDuration(3_723_000)).toBe('1h 2m 3s')
  })

  it('shows the real turn duration and Esc interrupt hint', () => {
    const now = 1_000_000
    const view = { ...emptyViewModel('session'), phase: 'running' as const, turnStartedAt: now - 87_000 }

    expect(renderWorkingMessage(view, now)).toBe('Working (1m 27s • esc to interrupt)')
  })

  it('uses Esc, never Ctrl+C, as the active-turn interrupt key', () => {
    const running = { ...emptyViewModel('session'), phase: 'running' as const }
    const idle = emptyViewModel('session')

    expect(isTurnInterruptInput('\x1b', running)).toBe(true)
    expect(isTurnInterruptInput('\x03', running)).toBe(false)
    expect(isTurnInterruptInput('\x1b', idle)).toBe(false)
  })

  it('keeps retry countdowns interruptible without a Ctrl+C hint', () => {
    const now = 1_000_000
    const view = {
      ...emptyViewModel('session'),
      phase: 'running' as const,
      turnStartedAt: now - 62_000,
      retryStatus: { retry: 2, maxRetries: 5, delayMs: 10_000, scheduledAt: now - 4_000 },
    }

    expect(renderWorkingMessage(view, now)).toBe('Retrying (2/5) in 6s (1m 2s • esc to interrupt)')
  })
})

describe('layoutStatusLine', () => {
  it('fits a long status and project label into 120 columns', () => {
    const left = [
      theme.accent('deepseek-v4-flash'),
      theme.accent('workspace-write'),
      theme.dim('ctx 15.8K/1M'),
      theme.dim('cached 82.7%'),
      theme.warning('a deliberately long provider activity message that cannot fit in the remaining space'),
    ].join(' · ')
    const line = layoutStatusLine(left, theme.accent('KikaInput'), 120)

    expect(visibleWidth(line)).toBe(120)
    expect(line).toContain('KikaInput')
  })

  it('handles narrow terminals and an oversized project label', () => {
    const line = layoutStatusLine('model · workspace-write', 'an-extremely-long-project-name', 20)

    expect(visibleWidth(line)).toBe(20)
  })

  it('fits a status row without a right-hand label', () => {
    const line = layoutStatusLine('a very long standalone status value', '', 16)

    expect(visibleWidth(line)).toBe(16)
  })
})

describe('tool diff rendering', () => {
  it('uses old line numbers for removals and new line numbers otherwise', () => {
    const rows = renderDiffRows([{
      path: 'src/example.ts',
      oldText: 'const first = 1\nconst retry = true\nconst last = 3\n',
      newText: 'const first = 1\nconst working = true\nconst last = 3\n',
    }])
    const plain = rows.map(row => stripTerminalSequences(row.text))

    expect(rows.map(row => row.kind)).toEqual(['context', 'context', 'removed', 'added', 'context'])
    expect(plain).toEqual([
      '  src/example.ts',
      ' 1    const first = 1',
      ' 2 -  const retry = true',
      ' 2 +  const working = true',
      ' 3    const last = 3',
    ])
  })

  it('aligns every line-number field to the widest file line number', () => {
    const oldText = Array.from({ length: 99 }, (_, index) => `old-${index + 1}`).join('\n')
    const newText = `${oldText}\nnew-100`
    const rows = renderDiffRows([{ path: 'large.ts', oldText, newText }])
    const plain = rows.map(row => stripTerminalSequences(row.text))

    expect(plain[1]).toMatch(/^   1    old-1$/)
    expect(plain.at(-1)).toBe(' 100 +  new-100')
  })

  it('paints added and removed rows across the complete terminal width', () => {
    const added = renderDiffRow({ text: ' 2 +  next', kind: 'added' }, 24)
    const removed = renderDiffRow({ text: ' 2 -  previous', kind: 'removed' }, 24)

    expect(visibleWidth(added)).toBe(24)
    expect(visibleWidth(removed)).toBe(24)
    if (process.env.NO_COLOR === undefined) {
      expect(added).toContain('\x1b[48;2;29;63;42m')
      expect(removed).toContain('\x1b[48;2;74;35;35m')
    }
  })
})

describe('reasoning rendering', () => {
  const reasoning = Array.from({ length: 8 }, (_, index) => `thought-${index + 1}`).join('\n')

  it('shows only the latest five visual lines when collapsed', () => {
    const lines = renderReasoningLines(reasoning, 30, false)
    const plain = lines.map(line => stripTerminalSequences(line))

    expect(lines).toHaveLength(5)
    expect(plain[0]).toContain('… thought-4')
    expect(plain.at(-1)).toContain('thought-8')
    expect(plain.join('\n')).not.toContain('thought-1')
    expect(lines.every(line => visibleWidth(line) === 30)).toBe(true)
  })

  it('shows every visual line after Ctrl+O expansion', () => {
    const lines = renderReasoningLines(reasoning, 30, true)
    const plain = lines.map(line => stripTerminalSequences(line))

    expect(lines).toHaveLength(8)
    expect(plain[0]).toContain('◌ thought-1')
    expect(plain.at(-1)).toContain('thought-8')
  })

  it('applies the five-line limit after wrapping long reasoning text', () => {
    const lines = renderReasoningLines('0123456789 '.repeat(12), 12, false)

    expect(lines).toHaveLength(5)
    expect(lines.every(line => visibleWidth(line) === 12)).toBe(true)
  })
})

describe('welcome banner', () => {
  it('preserves the whale silhouette at exactly half the source dimensions', () => {
    expect(WELCOME_WHALE_SOURCE).toHaveLength(28)
    expect(Math.max(...WELCOME_WHALE_SOURCE.map(line => line.length))).toBe(76)
    expect(halveBlockArt(WELCOME_WHALE_SOURCE)).toEqual(WELCOME_WHALE)
    expect(WELCOME_WHALE).toHaveLength(14)
    expect(Math.max(...WELCOME_WHALE.map(line => visibleWidth(line)))).toBe(38)
  })

  it('fills a wide terminal with small symmetric side margins', () => {
    const lines = renderWelcomeBanner('0.1.0', 120)
    const plain = lines.map(stripTerminalSequences)

    expect(plain).toHaveLength(20)
    expect(plain[0]).toMatch(/^ {2}╭─ dsh-code v0\.1\.0 /)
    expect(plain.every(line => visibleWidth(line) === 118)).toBe(true)
    expect(plain.some(line => line.includes('Welcome back!'))).toBe(true)
    expect(plain.some(line => line.includes('Tips'))).toBe(true)
  })

  it('stacks the whale and tips without overflowing narrow terminals', () => {
    const lines = renderWelcomeBanner('0.1.0', 60)
    const plain = lines.map(stripTerminalSequences)

    expect(plain.some(line => line.trimStart().startsWith('├'))).toBe(true)
    expect(plain.every(line => visibleWidth(line) <= 60)).toBe(true)
    expect(plain.some(line => line.includes('@ to reference files'))).toBe(true)
    for (const width of [20, 12]) {
      expect(renderWelcomeBanner('0.1.0', width).every(line => visibleWidth(line) <= width)).toBe(true)
    }
  })
})

describe('renderTodoLines', () => {
  const todos = [
    { content: '读取项目结构', status: 'completed' as const },
    { content: '修复状态栏中的长文本渲染问题', status: 'in_progress' as const },
    { content: '运行完整测试', status: 'pending' as const },
  ]

  it('renders completed, active, and pending tasks as separate rows', () => {
    const lines = renderTodoLines(todos, 80)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('✓')
    expect(lines[1]).toContain('▸')
    expect(lines[2]).toContain('○')
  })

  it('keeps every Todo row within the terminal width', () => {
    const lines = renderTodoLines([
      { content: '通读核心模型层（KeyboardController、KeyboardKeyData、HardKeyUtils、StyleConfiguration、Log）', status: 'in_progress' },
    ], 40)

    expect(lines).toHaveLength(1)
    expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(40)
  })

  it('adds vertical breathing room only around a non-empty Todo panel', () => {
    const panel = renderTodoPanel(todos, 80)

    expect(panel[0]).toBe('')
    expect(panel.at(-1)).toBe('')
    expect(panel.slice(1, -1)).toHaveLength(3)
    expect(renderTodoPanel([], 80)).toEqual([])
  })

  it('does not duplicate Todo content in the compact status line', () => {
    const view = {
      ...emptyViewModel('session'),
      todos: [{ content: 'Todo must stay in its own panel', status: 'in_progress' as const }],
    }

    const status = renderStatus(view, { provider: 'deepseek', model: 'deepseek-chat' })
    expect(status).toContain('deepseek-chat')
    expect(status).not.toContain('Todo must stay in its own panel')
  })
})

describe('main viewport layout', () => {
  class MutableLines implements Component {
    constructor(readonly lines: string[]) {}
    invalidate(): void {}
    render(): string[] { return [...this.lines] }
  }

  it('pins the interaction region while streaming and preserves manual transcript scrolling', () => {
    const transcript = new MutableLines(Array.from({ length: 20 }, (_, index) => `line-${index}`))
    const bottomLines = ['todo', 'working', 'editor', 'status']
    const bottom = new MutableLines(bottomLines)
    const layout = createMainViewportLayout(transcript, bottom)

    let frame = renderLayoutFrame(layout, 30, 10, () => {})
    expect(frame.lines.slice(-bottomLines.length)).toEqual(bottomLines)
    expect(frame.primaryScrollView?.isFollowingEnd).toBe(true)

    transcript.lines.push('line-20')
    frame = renderLayoutFrame(layout, 30, 10, () => {})
    expect(frame.lines.slice(-bottomLines.length)).toEqual(bottomLines)
    expect(frame.lines).toContain('line-20')

    frame.primaryScrollView?.scrollBy(-2)
    transcript.lines.push('line-21')
    frame = renderLayoutFrame(layout, 30, 10, () => {})
    expect(frame.primaryScrollView?.isFollowingEnd).toBe(false)
    expect(frame.lines.slice(-bottomLines.length)).toEqual(bottomLines)
    expect(frame.lines).not.toContain('line-21')

    frame.primaryScrollView?.scrollToEnd()
    transcript.lines.push('line-22')
    frame = renderLayoutFrame(layout, 30, 10, () => {})
    expect(frame.primaryScrollView?.isFollowingEnd).toBe(true)
    expect(frame.lines.slice(-bottomLines.length)).toEqual(bottomLines)
    expect(frame.lines).toContain('line-22')
  })

  it('bottom-aligns a short welcome transcript immediately above the interaction region', () => {
    const transcript = new MutableLines(['welcome-top', 'welcome-bottom'])
    // The leading blank row mirrors editorSlot's existing Spacer.
    const bottom = new MutableLines(['', 'editor'])
    const layout = createMainViewportLayout(transcript, bottom)

    const frame = renderLayoutFrame(layout, 40, 8, () => {})
    expect(frame.lines).toEqual([
      '', '', '', '',
      'welcome-top', 'welcome-bottom',
      '', 'editor',
    ])
  })
})
