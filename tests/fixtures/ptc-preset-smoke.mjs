import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'dsh-code-ptc-preset-smoke'
export const inject = ['agents', 'agentPresets', 'systemPrompt', 'ptcRuntime']

export function apply(ctx) {
  void (async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('ptc-preset-smoke'),
      meta: { cwd: process.cwd(), agentPreset: 'ptc' },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'ptc') },
    })
    try {
      const assembly = await ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
      const runtimeResult = await ctx.ptcRuntime.run(ctx.ptcRuntime.resolve({
        program: 'const value: number = 42; return value',
        bindings: [],
      }))
      process.stdout.write(`${JSON.stringify({
        preset: ctx.agentPresets.composedPreset(handle.agent.ctx),
        headerPreset: handle.agent.session.header.agentPreset,
        runtimeLanguage: ctx.ptcRuntime.language,
        runtimeIsolation: ctx.ptcRuntime.isolation,
        runtimeResult,
        agentTools: assembly.tools.map(tool => tool.name),
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
