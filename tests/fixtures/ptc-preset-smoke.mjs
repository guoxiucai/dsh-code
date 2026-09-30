import { SessionId } from '@deepseek-ai/dsh-session'
import { isTimedAskUserQuestionSchema } from '@deepseek-ai/dsh-user-questions'

export const name = 'dsh-code-ptc-preset-smoke'
export const inject = ['agents', 'agentPresets', 'systemPrompt', 'ptcRuntime', 'tools']

export function apply(ctx) {
  void (async () => {
    await ctx.loader.await()
    const handle = await ctx.agents.create({
      sessionId: SessionId('ptc-preset-smoke'),
      meta: { cwd: process.cwd(), agentPreset: 'ptc' },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'ptc') },
    })
    try {
      const assembly = await ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
      const questionTool = ctx.tools.schemas(handle.agent).find(tool => tool.name === 'ask_user_question')
      if (questionTool === undefined) throw new Error('PTC preset has no ask_user_question tool')
      const runtimeResult = await ctx.ptcRuntime.run(ctx.ptcRuntime.resolve({
        program: 'const value: number = 42; return value',
        bindings: [],
      }))
      if (runtimeResult.error !== undefined) {
        throw new Error(`PTC execution failed: ${JSON.stringify(runtimeResult)}`)
      }
      process.stdout.write(`${JSON.stringify({
        preset: ctx.agentPresets.composedPreset(handle.agent.ctx),
        headerPreset: handle.agent.session.header.agentPreset,
        runtimeLanguage: ctx.ptcRuntime.language,
        runtimeIsolation: ctx.ptcRuntime.isolation,
        runtimeResult,
        agentTools: assembly.tools.map(tool => tool.name),
        timedQuestions: isTimedAskUserQuestionSchema(questionTool),
        hasSdk: assembly.sections.some(section => section.name === 'tools:sdk'),
      })}\n`)
    } finally {
      await handle.dispose()
    }
    ctx.get('appExit')?.(0)
  })().catch((error) => {
    process.stderr.write(`PTC preset smoke: ${error instanceof Error ? error.stack : String(error)}\n`)
    ctx.get('appExit')?.(1)
  })
}
