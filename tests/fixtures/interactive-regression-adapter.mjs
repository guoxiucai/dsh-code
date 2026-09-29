/** Keyless, observable pre-token cancellation and shell-context PTY fixture. */
import { appendFileSync } from 'node:fs'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

function record(event) {
  if (process.env.DSH_CODE_TEST_TRACE) appendFileSync(process.env.DSH_CODE_TEST_TRACE, `${event}\n`)
}

class InteractiveAdapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    const texts = options.messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
    const last = texts.at(-1) ?? ''
    record('stream-start')
    if (last.includes('SLOW_PRETOKEN')) {
      // No chunk is emitted until this wait finishes: Esc must cancel while
      // the terminal has only a Working indicator, not an assistant draft.
      await new Promise((resolve, reject) => {
        const finish = () => { options.signal?.removeEventListener('abort', abort); resolve() }
        const timer = setTimeout(finish, 15_000)
        const abort = () => {
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', abort)
          record('stream-abort')
          reject(new DOMException('Aborted', 'AbortError'))
        }
        options.signal?.addEventListener('abort', abort, { once: true })
        if (options.signal?.aborted) abort()
      })
    }
    const text = `CONTEXT included=${texts.some(value => value.includes('SHELL_INCLUDED_928'))} excluded=${texts.some(value => value.includes('SHELL_EXCLUDED_928'))}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
    record('stream-finish')
  }
}

export const name = 'dsh-code-interactive-regression'
export const inject = ['llm']
export function apply(ctx) { ctx.llm.registerAdapter(['mock'], new InteractiveAdapter()) }
