import { describe, expect, it } from 'vitest'
import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import {
  createMainViewportLayout,
  layoutStatusLine,
  renderStatus,
  renderTodoLines,
  renderTodoPanel,
} from '../../src/tui/host.ts'
import { theme } from '../../src/tui/theme.ts'
import { emptyViewModel } from '../../src/tui/view-model.ts'

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
})
