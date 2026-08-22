import { describe, expect, it, vi } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { InlineTextInputComponent, ListSelectorComponent } from '../../src/tui/selector.ts'

const identity = (text: string): string => text

describe('InlineTextInputComponent', () => {
  it('submits trimmed text with Enter', () => {
    const onSubmit = vi.fn()
    const input = new InlineTextInputComponent({
      prompt: 'Value:',
      borderColor: identity,
      onSubmit,
      onCancel: vi.fn(),
    })

    input.handleInput('  value  ')
    input.handleInput('\r')

    expect(onSubmit).toHaveBeenCalledWith('value')
  })

  it('uses Esc as the wizard back action', () => {
    const onCancel = vi.fn()
    const input = new InlineTextInputComponent({
      prompt: 'Value:',
      borderColor: identity,
      onSubmit: vi.fn(),
      onCancel,
    })

    input.handleInput('\x1b')

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('reserves Ctrl+C for terminal copy instead of going back', () => {
    const onCancel = vi.fn()
    const input = new InlineTextInputComponent({
      prompt: 'Value:',
      borderColor: identity,
      onSubmit: vi.fn(),
      onCancel,
    })

    input.handleInput('\x03')

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('restores an earlier value with the cursor at its end', () => {
    const onSubmit = vi.fn()
    const input = new InlineTextInputComponent({
      prompt: 'Value:',
      initialValue: 'saved',
      borderColor: identity,
      onSubmit,
      onCancel: vi.fn(),
    })

    input.handleInput('-next')
    input.handleInput('\r')

    expect(onSubmit).toHaveBeenCalledWith('saved-next')
  })

  it('renders the suggested value as actual input text', () => {
    const input = new InlineTextInputComponent({
      prompt: 'Credential:',
      initialValue: 'DEEPSEEK_API_KEY',
      borderColor: identity,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    })

    expect(input.render(80).join('\n')).toContain('> DEEPSEEK_API_KEY')
  })

  it('does not advance on an empty value', () => {
    const onSubmit = vi.fn()
    const input = new InlineTextInputComponent({
      prompt: 'Value:',
      borderColor: identity,
      onSubmit,
      onCancel: vi.fn(),
    })

    input.handleInput('   ')
    input.handleInput('\r')

    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('ListSelectorComponent', () => {
  it('applies an initial command search and submits the visible match', () => {
    const onSelect = vi.fn()
    const selector = new ListSelectorComponent({
      hint: 'Skills',
      items: [
        { value: 'alpha', label: 'alpha' },
        { value: 'beta', label: 'beta' },
      ],
      initialQuery: 'bet',
      borderColor: identity,
      onSelect,
      onCancel: vi.fn(),
    })

    expect(selector.render(80).join('\n')).toContain('beta')
    expect(selector.render(80).join('\n')).not.toContain('alpha')
    selector.handleInput('\r')
    expect(onSelect).toHaveBeenCalledWith('beta')
  })

  it('keeps long source descriptions to one fitted row', () => {
    const selector = new ListSelectorComponent({
      hint: 'A deliberately long selector hint '.repeat(5),
      items: [{ value: 'skill', label: 'skill', description: `第一行\n${'很长的技能描述'.repeat(30)}` }],
      borderColor: identity,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    })
    const lines = selector.render(40)

    expect(lines).toHaveLength(6)
    expect(lines.every(line => visibleWidth(line) <= 40)).toBe(true)
    expect(lines.join('\n')).toContain('第一行 ')
  })

  it('uses Space for an in-place toggle without submitting', () => {
    const onSelect = vi.fn()
    const onToggle = vi.fn()
    const selector = new ListSelectorComponent({
      hint: 'Space toggle · Enter use',
      items: [{ value: 'skill', label: 'skill', current: true }],
      borderColor: identity,
      onSelect,
      onToggle,
      onCancel: vi.fn(),
    })

    selector.handleInput(' ')

    expect(onToggle).toHaveBeenCalledWith('skill')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders grouped headings and skips them during navigation', () => {
    const onSelect = vi.fn()
    const selector = new ListSelectorComponent({
      hint: 'MCP servers',
      items: [
        { value: 'heading:a', label: 'Claude Code (~/.claude.json):', selectable: false, section: 'a' },
        { value: 'a', label: '  fullsdk ○ not connected', section: 'a' },
        { value: 'heading:b', label: 'OpenAI Codex (~/.codex/config.toml):', selectable: false, section: 'b' },
        { value: 'b', label: '  gitlab ● connected', section: 'b' },
      ],
      borderColor: identity,
      onSelect,
      onCancel: vi.fn(),
    })

    selector.handleInput('\r')
    expect(onSelect).toHaveBeenLastCalledWith('a')
    selector.handleInput('\x1b[B')
    selector.handleInput('\r')
    expect(onSelect).toHaveBeenLastCalledWith('b')
  })
})
