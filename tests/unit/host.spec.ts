import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTerminalSequences, visibleWidth, type Component, type TUI } from '@earendil-works/pi-tui'
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import {
  createMainViewportLayout,
  createAutocompleteProvider,
  AGENTS_PANEL_URL,
  DEFAULT_PROMPT_PLACEHOLDER,
  formatActivityDuration,
  halveBlockArt,
  isTurnInterruptInput,
  layoutStatusLine,
  PlaceholderEditor,
  TranscriptSurface,
  renderDiffRow,
  renderDiffRows,
  renderReasoningLines,
  renderQueuedMessageLines,
  renderSubagentIndicator,
  renderWorkingMessage,
  renderWelcomeBanner,
  renderStatus,
  renderToolOutputLines,
  renderTranscriptItemLines,
  renderTodoLines,
  renderTodoPanel,
  WELCOME_WHALE,
  WELCOME_WHALE_SOURCE,
} from '../../src/tui/host.ts'
import { theme } from '../../src/tui/theme.ts'
import { emptyViewModel } from '../../src/tui/view-model.ts'

describe('default prompt editor', () => {
  const editorTheme = {
    borderColor: (text: string) => text,
    selectList: {
      selectedPrefix: (text: string) => text,
      selectedText: (text: string) => text,
      description: (text: string) => text,
      scrollInfo: (text: string) => text,
      noMatch: (text: string) => text,
    },
  }
  const fakeTui = {
    terminal: { rows: 24 },
    requestRender: () => {},
  } as unknown as TUI

  it('renders a visual placeholder without adding it to the submitted value', () => {
    const editor = new PlaceholderEditor(fakeTui, editorTheme, DEFAULT_PROMPT_PLACEHOLDER, { paddingX: 1 })
    editor.focused = true

    const lines = editor.render(50)

    expect(lines.map(stripTerminalSequences)).toContain(`  ${DEFAULT_PROMPT_PLACEHOLDER}${' '.repeat(20)}`)
    expect(editor.getText()).toBe('')
    expect(lines.every(line => visibleWidth(line) === 50)).toBe(true)
  })

  it('hides the placeholder as soon as the editor has content', () => {
    const editor = new PlaceholderEditor(fakeTui, editorTheme, DEFAULT_PROMPT_PLACEHOLDER, { paddingX: 1 })
    editor.setText('Explain this repository')

    const rendered = editor.render(50).map(stripTerminalSequences).join('\n')

    expect(rendered).toContain('Explain this repository')
    expect(rendered).not.toContain(DEFAULT_PROMPT_PLACEHOLDER)
  })

  it('renders large-paste markers with the dsh-code accent role', () => {
    const editor = new PlaceholderEditor(fakeTui, editorTheme, DEFAULT_PROMPT_PLACEHOLDER, { paddingX: 1 })
    const pasted = Array.from({ length: 11 }, (_, index) => `line ${index + 1}`).join('\n')

    editor.handleInput(`\x1b[200~${pasted}\x1b[201~`)

    const marker = '[paste #1 +11 lines]'
    expect(editor.render(80).join('\n')).toContain(theme.accent(marker))
    expect(editor.getExpandedText()).toBe(pasted)
  })
})

describe('file reference autocomplete', () => {
  const tempDirectories: string[] = []

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('fuzzy-suggests local files and folders for @ keywords without requiring fd', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'dsh-code-autocomplete-'))
    tempDirectories.push(basePath)
    mkdirSync(join(basePath, 'src', 'prompt-queue'), { recursive: true })
    writeFileSync(join(basePath, 'src', 'prompt-queue', 'controller.ts'), '')
    mkdirSync(join(basePath, 'docs', 'queue-guide'), { recursive: true })

    const provider = createAutocompleteProvider([], basePath)
    const suggestions = await provider.getSuggestions(
      ['Please inspect @queue'],
      0,
      'Please inspect @queue'.length,
      { signal: new AbortController().signal },
    )

    expect(suggestions?.prefix).toBe('@queue')
    expect(suggestions?.items.map(item => item.description)).toEqual(expect.arrayContaining([
      'docs/queue-guide',
      'src/prompt-queue',
      'src/prompt-queue/controller.ts',
    ]))
  })
})

describe('incremental transcript surface', () => {
  it('does not rebuild or rerender committed blocks for a draft-only update', () => {
    let builds = 0
    let renders = 0
    const surface = new TranscriptSurface({
      renderItem: item => {
        builds += 1
        return [{
          invalidate: () => {},
          render: () => { renders += 1; return [item.kind] },
        }]
      },
      renderDraft: draft => [{
        invalidate: () => {},
        render: () => [`draft:${draft?.text ?? ''}`],
      }],
    })
    const transcript = [
      { kind: 'user' as const, text: 'question' },
      { kind: 'assistant' as const, text: 'answer' },
    ]

    surface.sync({ transcript, draft: undefined, expanded: false, version: '1', shellResults: [], notices: [] })
    expect(surface.render(80)).toContain('assistant')
    expect({ builds, renders }).toEqual({ builds: 2, renders: 2 })

    surface.sync({ transcript, draft: { text: 'next', reasoning: '' }, expanded: false, version: '1', shellResults: [], notices: [] })
    expect(surface.render(80)).toContain('draft:next')
    expect({ builds, renders }).toEqual({ builds: 2, renders: 2 })

    // An input-only frame returns the same line snapshot by reference.
    const first = surface.render(80)
    expect(surface.render(80)).toBe(first)
    expect({ builds, renders }).toEqual({ builds: 2, renders: 2 })
  })

  it('reuses the stable prefix when one transcript item changes', () => {
    let builds = 0
    const surface = new TranscriptSurface({
      renderItem: item => {
        builds += 1
        return [{ invalidate: () => {}, render: () => [item.kind] }]
      },
    })
    const user = { kind: 'user' as const, text: 'question' }
    const running = { kind: 'tool' as const, callId: '1', name: 'read', arguments: '{}', status: 'running' as const }

    surface.sync({ transcript: [user, running], draft: undefined, expanded: false, version: '1', shellResults: [], notices: [] })
    surface.render(80)
    expect(builds).toBe(2)

    const done = { ...running, status: 'done' as const, resultText: 'ok' }
    surface.sync({ transcript: [user, done], draft: undefined, expanded: false, version: '1', shellResults: [], notices: [] })
    surface.render(80)
    expect(builds).toBe(3)
  })

  it('lets later transcript output flow after a one-time UI notice', () => {
    const surface = new TranscriptSurface({
      renderItem: item => [{ invalidate: () => {}, render: () => [item.kind === 'assistant' ? item.text : item.kind] }],
    })
    const user = { kind: 'user' as const, text: 'question' }
    const assistant = { kind: 'assistant' as const, text: 'new output' }

    surface.sync({ transcript: [user], draft: undefined, expanded: false, version: '1', shellResults: [], notices: ['agent detail'] })
    expect(surface.render(80).map(stripTerminalSequences).join('\n')).toContain('agent detail')

    surface.sync({ transcript: [user, assistant], draft: undefined, expanded: false, version: '1', shellResults: [], notices: ['agent detail'] })
    const lines = surface.render(80).map(stripTerminalSequences)
    expect(lines.findIndex(line => line.includes('agent detail'))).toBeLessThan(lines.indexOf('new output'))
  })
})

describe('queued follow-up panel', () => {
  it('shows accepted messages as queued and keeps previews width-safe', () => {
    const lines = renderQueuedMessageLines([
      { id: 'one', text: 'Run this after the current task finishes' },
      { id: 'two', text: 'Then inspect the generated report' },
    ], 32)
    const plain = lines.map(stripTerminalSequences)

    expect(plain[1]).toContain('↳ Queued 1: Run this after')
    expect(plain[2]).toContain('↳ Queued 2: Then inspect')
    expect(lines.every(line => visibleWidth(line) <= 32)).toBe(true)
  })
})

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

describe('subagent status', () => {
  it('renders only as an independent clickable row while subagents are active', () => {
    const view = emptyViewModel('session')

    expect(renderStatus(view)).not.toContain('subagent')
    expect(renderSubagentIndicator(0, 80)).toEqual([])
    const active = renderSubagentIndicator(2, 80).join('\n')
    expect(active).toContain('⚡ 2 subagents running')
    expect(active).toContain(AGENTS_PANEL_URL)
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

describe('tool output rendering', () => {
  it('marks PTC child calls as nested and summarizes run_code by description', () => {
    const child = renderTranscriptItemLines({
      kind: 'tool',
      callId: 'root:code:1',
      parentCallId: 'root',
      name: 'read',
      arguments: JSON.stringify({ path: 'src/index.ts' }),
      status: 'done',
      resultText: 'ok',
    }, 60, false).map(stripTerminalSequences).join('\n')
    const root = renderTranscriptItemLines({
      kind: 'tool',
      callId: 'root',
      name: 'run_code',
      arguments: JSON.stringify({ description: 'Inspect project', code: 'very long code' }),
      status: 'running',
    }, 60, false).map(stripTerminalSequences).join('\n')

    expect(child).toContain('↳ ⚙ read')
    expect(root).toContain('$ Inspect project')
    expect(root).not.toContain('very long code')
  })

  it('limits a running subagent card with a long single-line prompt to five body rows', () => {
    const item = {
      kind: 'tool',
      callId: 'subagent-1',
      name: 'subagent',
      arguments: JSON.stringify({ description: 'inspect', prompt: 'long prompt '.repeat(80) }),
      status: 'running',
    } as const
    const lines = renderTranscriptItemLines(item, 36, false)

    // Two card borders + one header + at most five collapsed body rows.
    expect(lines).toHaveLength(8)
    expect(renderTranscriptItemLines(item, 36, true).length).toBeGreaterThan(lines.length)
  })

  it('keeps file-edit diffs fully visible in the default collapsed mode', () => {
    const lines = renderTranscriptItemLines({
      kind: 'tool',
      callId: 'edit-1',
      name: 'edit',
      arguments: JSON.stringify({ path: 'sample.ts' }),
      status: 'done',
      diffs: [{
        path: 'sample.ts',
        oldText: Array.from({ length: 8 }, (_, index) => `old-${index + 1}`).join('\n'),
        newText: Array.from({ length: 8 }, (_, index) => `new-${index + 1}`).join('\n'),
      }],
    }, 60, false).map(stripTerminalSequences)

    expect(lines.join('\n')).toContain('old-1')
    expect(lines.join('\n')).toContain('new-1')
  })

  it('retains at most five visual rows including an exact hidden-line marker', () => {
    const text = Array.from({ length: 8 }, (_, index) => `line-${index + 1}`).join('\n')
    const collapsed = renderToolOutputLines(text, 80, false).map(stripTerminalSequences)

    expect(collapsed).toEqual([
      '  … (4 earlier visual lines, ctrl+o to expand)',
      '  line-5', '  line-6', '  line-7', '  line-8',
    ])
    expect(renderToolOutputLines(text, 80, true).map(stripTerminalSequences)).toHaveLength(8)
  })

  it('preserves a trailing empty logical line', () => {
    expect(renderToolOutputLines('one\ntwo\n', 80, false).map(stripTerminalSequences)).toEqual([
      '  one', '  two', '  ',
    ])
  })

  it('applies the limit after a single long result line wraps visually', () => {
    expect(renderToolOutputLines('long result '.repeat(80), 24, false)).toHaveLength(5)
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

  it('shows the selected agent mode as independent status chrome', () => {
    const status = renderStatus(emptyViewModel('session'), { provider: 'deepseek', model: 'deepseek-chat' }, undefined, 'ptc')
    expect(stripTerminalSequences(status)).toContain('deepseek-chat · PTC')
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
