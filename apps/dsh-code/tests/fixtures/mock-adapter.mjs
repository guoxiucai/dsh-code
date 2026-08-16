/**
 * Keyless deterministic mock LLM adapter for the dsh-code closed-loop test.
 * First response requests one real `bash` tool round-trip; the second response
 * echoes the tool result as the final answer. Exercises assistant chunks, a
 * tool/call + tool/result pair, and token usage — the same event shapes the TUI
 * reducer consumes. Loaded as a plain .mjs so the `dsh` CLI can import it via an
 * absolute file URL without tsx.
 */

import { CallId, LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')

class MockAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: HIGH, name: 'High' }], defaultEffort: HIGH },
    }
  }

  async *stream(options) {
    const last = options.messages.at(-1)
    const toolResult = last?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const args = JSON.stringify({ command: 'printf DSH_CODE_TOOL_ROUND_TRIP', description: 'Prove the tool round trip.' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('dsh-code-call'), name: 'bash', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('dsh-code-call'), name: 'bash', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const toolText = toolResult.content.filter(b => b.type === 'text').map(b => b.text).join('')
    const reply = `DSH_CODE round trip complete: ${toolText.trim()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'dsh-code-mock-llm'
export const inject = ['llm']

export function apply(ctx) {
  ctx.llm.registerAdapter(['mock'], new MockAdapter())
}
