import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const CONCURRENT_SUBAGENT_TOOLS = new Set(['subagent', 'subagent_fork'])
const CONCURRENT_SUBAGENT_GUIDANCE = 'Always run subagent and subagent_fork in the background so the parent remains available to dispatch more work. Never set run_in_background to false; when later work needs a child result, let the background completion notice start the follow-up turn.'

/**
 * Keep the parent turn available for further delegations. The shipped Standard
 * and Code presets run these continuable tools in the background when the flag
 * is true or omitted; only an explicit false can turn them into a blocking
 * foreground wait.
 */
export function concurrentSubagentDenial(
  execution: Pick<ToolExecution, 'name' | 'arguments'>,
): string | undefined {
  if (!CONCURRENT_SUBAGENT_TOOLS.has(execution.name)) return undefined
  if (typeof execution.arguments !== 'object' || execution.arguments === null) return undefined
  if ((execution.arguments as Record<string, unknown>).run_in_background !== false) return undefined
  return 'dsh-code runs subagents in the background so the parent can dispatch concurrent work; retry with run_in_background: true or omit it'
}

/** Install proactive guidance and the enforcing guard through public scoped registries. */
export function installConcurrentSubagentPolicy(
  ctx: Pick<Context, 'systemPrompt' | 'tools'>,
): () => void {
  const disposeGuard = ctx.tools.guard(concurrentSubagentDenial)
  const disposeGuidance = ctx.systemPrompt.section({
    name: 'dsh-code:subagent-concurrency',
    order: 199,
    text: CONCURRENT_SUBAGENT_GUIDANCE,
  })
  return () => {
    disposeGuidance()
    disposeGuard()
  }
}
