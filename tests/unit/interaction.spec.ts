import { describe, expect, it } from 'vitest'
import { stripTerminalSequences } from '@earendil-works/pi-tui'
import {
  ApprovalBarComponent,
  QuestionPanelComponent,
  interactionLinesFit,
} from '../../src/tui/interaction.ts'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

describe('inline approval bar', () => {
  it('renders the call identity and resolves a one-shot rejection', () => {
    let outcome: string | undefined
    const panel = new ApprovalBarComponent(
      { toolName: 'bash', callId: 'call-42', reason: 'escalate sandbox to danger-full-access' },
      value => { outcome = value },
      () => { outcome = 'cancelled' },
    )
    const lines = panel.render(52)
    const plain = lines.map(stripTerminalSequences).join('\n')

    expect(interactionLinesFit(lines, 52)).toBe(true)
    expect(plain).toContain('Approval required · bash · call-42')
    expect(plain).toContain('escalate sandbox')
    expect(plain).toContain('→ Allow once\n  Reject')
    panel.handleInput('\x1b[B')
    panel.handleInput('\r')
    expect(outcome).toBe('rejected')
  })

  it('maps Esc to cancellation', () => {
    let cancelled = false
    const panel = new ApprovalBarComponent(
      { toolName: 'write' },
      () => {},
      () => { cancelled = true },
    )

    panel.handleInput('\x1b')
    expect(cancelled).toBe(true)
  })
})

describe('structured question panel', () => {
  function panel(
    questions: AskUserQuestionItem[],
    receive: (answer: AskUserQuestionAnswer) => void,
  ): QuestionPanelComponent {
    const result = new QuestionPanelComponent(questions, receive, () => {})
    result.focused = true
    return result
  }

  it('returns one selected label for a single-choice question', () => {
    let answer: AskUserQuestionAnswer | undefined
    const control = panel([{
      id: 'mode',
      header: 'Mode',
      question: 'Choose a mode',
      options: [{ label: 'Safe' }, { label: 'Fast' }],
    }], value => { answer = value })

    control.handleInput('\x1b[B')
    control.handleInput('\r')
    expect(answer).toEqual({ answers: [{ id: 'mode', selected: ['Fast'] }] })
  })

  it('supports checked options together with a custom multi-select answer', () => {
    let answer: AskUserQuestionAnswer | undefined
    const control = panel([{
      id: 'features',
      question: 'Select features',
      options: [{ label: 'Diff' }, { label: 'Plan' }],
      multiSelect: true,
    }], value => { answer = value })

    control.handleInput(' ')
    control.handleInput('\x1b[B')
    control.handleInput(' ')
    control.handleInput('\x1b[B')
    control.handleInput('\r')
    control.handleInput('Custom UI')
    control.handleInput('\r')
    control.handleInput('\r')

    expect(answer).toEqual({
      answers: [{ id: 'features', selected: ['Diff', 'Plan'], custom: 'Custom UI' }],
    })
  })

  it('collects a free-text answer when no options are supplied', () => {
    let answer: AskUserQuestionAnswer | undefined
    const control = panel([{
      id: 'detail',
      question: 'What should change?',
    }], value => { answer = value })

    control.handleInput('Keep the public API stable')
    control.handleInput('\n')
    expect(answer).toEqual({
      answers: [{ id: 'detail', selected: [], custom: 'Keep the public API stable' }],
    })
  })

  it('returns from custom input to the same selector with Esc', () => {
    let cancelled = false
    const control = new QuestionPanelComponent([{
      id: 'mode',
      question: 'Choose a mode',
      options: [{ label: 'Safe' }],
    }], () => {}, () => { cancelled = true })
    control.focused = true

    const initialHeight = control.render(60).length
    control.handleInput('\x1b[B')
    const placeholder = control.render(60).map(stripTerminalSequences)
    expect(placeholder).toContain('→ Type an answer…')
    expect(placeholder).toHaveLength(initialHeight)
    control.handleInput('\r')
    const editing = control.render(60).map(stripTerminalSequences)
    expect(editing).toHaveLength(initialHeight)
    expect(editing.join('\n')).toContain('Enter confirm · Esc back')
    expect(editing.join('\n')).not.toContain('Type an answer')
    control.handleInput('\x1b')

    const restored = control.render(60).map(stripTerminalSequences).join('\n')
    expect(restored).toContain('Type an answer')
    expect(cancelled).toBe(false)
  })

  it('reserves the option-description row while moving onto custom input', () => {
    const control = panel([{
      id: 'mode',
      question: 'Choose a mode',
      options: [{ label: 'Automatic', description: 'Retry with one-time approval.' }],
    }], () => {})
    const optionHeight = control.render(60).length

    control.handleInput('\x1b[B')
    expect(control.render(60)).toHaveLength(optionHeight)
    control.handleInput('\r')
    expect(control.render(60)).toHaveLength(optionHeight)
  })

  it('renders plan-review detail in a bounded, scrollable panel', () => {
    const control = panel([{
      id: 'plan-review',
      header: 'Plan review',
      question: 'Approve this plan?',
      detail: ['# Plan', '', ...Array.from({ length: 12 }, (_, index) => `- Step ${index + 1}`)].join('\n'),
      options: [{ label: 'Approve plan' }, { label: 'Keep planning' }],
      intent: { kind: 'plan-review', approve: 'Approve plan' },
    }], () => {})
    const before = control.render(48)
    const plainBefore = before.map(stripTerminalSequences).join('\n')

    expect(interactionLinesFit(before, 48)).toBe(true)
    expect(plainBefore).toContain('Plan review 1/1')
    expect(plainBefore).toContain('PgUp/PgDn scroll')
    control.handleInput('\x1b[6~')
    const after = control.render(48).map(stripTerminalSequences).join('\n')
    expect(after).not.toBe(plainBefore)
  })

  it('returns every question id in request order', () => {
    let answer: AskUserQuestionAnswer | undefined
    const control = panel([
      { id: 'first', question: 'First?', options: [{ label: 'Yes' }] },
      { id: 'second', question: 'Second?', options: [{ label: 'No' }] },
    ], value => { answer = value })

    control.handleInput('\r')
    control.handleInput('\r')
    expect(answer).toEqual({ answers: [
      { id: 'first', selected: ['Yes'] },
      { id: 'second', selected: ['No'] },
    ] })
  })
})
