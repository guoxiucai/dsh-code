import { describe, expect, it, vi } from 'vitest'
import { InlineTextInputComponent } from '../../src/tui/selector.ts'

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
