import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  concurrentSubagentDenial,
  installConcurrentSubagentPolicy,
} from '../../src/tui/subagent-concurrency-policy.ts'

const signal = new AbortController().signal

describe('subagent concurrency policy', () => {
  it('stops a foreground child before it can block the parent turn', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let bodyCalls = 0
    ctx.tools.register(defineTool({
      name: 'subagent',
      description: 'test subagent',
      parameters: {
        run_in_background: { type: 'boolean' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { started: { type: 'boolean', required: true } },
        },
        render: () => [],
      },
      execute: async () => {
        bodyCalls += 1
        return { started: true }
      },
    }))
    const disposePolicy = installConcurrentSubagentPolicy(ctx)
    expect((await ctx.systemPrompt.assemble()).sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'dsh-code:subagent-concurrency',
        text: expect.stringContaining('Never set run_in_background to false'),
      }),
    ]))

    const result = await ctx.tools.execute({
      signal,
      callId: ToolCallId('foreground-child'),
      name: 'subagent',
      arguments: { run_in_background: false },
    })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('background') }),
    ]))
    expect(bodyCalls).toBe(0)
    disposePolicy()
    expect((await ctx.systemPrompt.assemble()).sections).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'dsh-code:subagent-concurrency' }),
    ]))
  })

  it('allows background and unrelated calls without changing their arguments', () => {
    expect(concurrentSubagentDenial({
      name: 'subagent',
      arguments: { run_in_background: true },
    })).toBeUndefined()
    expect(concurrentSubagentDenial({
      name: 'subagent_fork',
      arguments: {},
    })).toBeUndefined()
    expect(concurrentSubagentDenial({
      name: 'bash',
      arguments: { run_in_background: false },
    })).toBeUndefined()
  })

  it('applies the same non-blocking rule to forked subagents', () => {
    expect(concurrentSubagentDenial({
      name: 'subagent_fork',
      arguments: { run_in_background: false },
    })).toContain('concurrent work')
  })
})
