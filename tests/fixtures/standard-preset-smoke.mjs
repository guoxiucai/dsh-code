import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'dsh-code-standard-preset-smoke'
export const inject = ['agents', 'agentPresets', 'sessionQuery', 'tools', 'agentDefaultModel', 'settings', 'llm']

export function apply(ctx) {
  void (async () => {
    await ctx.loader.await()
    if (process.env.DSH_CODE_TEST_SAVE_MODEL === '1') {
      await ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'test-provider'], value: {
        apiKeyEnv: 'DSH_CODE_TEST_KEY', baseURL: 'https://example.com/v1', api: 'openai-completions',
        models: [{ id: 'test-model' }],
      } }])
      await ctx.agentDefaultModel.saveSelection({ provider: 'test-provider', model: 'test-model' })
    }
    const handle = await ctx.agents.create({
      sessionId: SessionId(process.env.DSH_CODE_TEST_SAVE_MODEL === '1' ? 'settings-save-smoke' : 'standard-preset-smoke'),
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
        defaultModel: ctx.agentDefaultModel.currentSelection(),
        providers: ctx.llm.listProviders().map(provider => provider.id),
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
