import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'dsh-code-standard-preset-smoke'
export const inject = ['agents', 'agentPresets', 'sessionQuery', 'tools']

export function apply(ctx) {
  void (async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('standard-preset-smoke'),
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    try {
      const projectSessions = await ctx.sessionQuery.filterSessions([{ kind: 'cwd', values: [process.cwd()] }])
      process.stdout.write(`${JSON.stringify({
        preset: ctx.agentPresets.composedPreset(handle.agent.ctx),
        headerPreset: handle.agent.session.header.agentPreset,
        agentTools: ctx.tools.schemas(handle.agent).map(tool => tool.name),
        globalTools: ctx.tools.schemas().map(tool => tool.name),
        querySessionIds: projectSessions.map(record => String(record.header.id)),
      })}\n`)
    } finally {
      await handle.dispose()
    }
    ctx.get('appExit')?.(0)
  })().catch((error) => {
    process.stderr.write(`standard preset smoke: ${error instanceof Error ? error.stack : String(error)}\n`)
    ctx.get('appExit')?.(1)
  })
}
