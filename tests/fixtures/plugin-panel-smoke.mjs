/** Drive the product panel against a real profile, Loader, package manager and Agent. */
import assert from 'node:assert/strict'
import { stripVTControlCharacters } from 'node:util'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PluginPanel } from '../../src/tui/plugin-manager.ts'

export const name = 'dsh-code-plugin-panel-smoke'
export const inject = ['agents', 'agentPresets', 'pluginManager', 'tools']

export function apply(ctx) {
  void (async () => {
    await ctx.loader.await()
    const setup = async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard') }
    const handle = process.env.PLUGIN_PANEL_PHASE === 'install'
      ? await ctx.agents.create({ sessionId: SessionId('plugins-smoke'),
        meta: { cwd: process.cwd(), agentPreset: 'standard' }, setup })
      : await ctx.agents.resume({ resumeSessionId: SessionId('plugins-smoke'), setup })
    let selector
    let input
    const screens = []
    const host = {
      showSelector(options) {
        selector = options
        screens.push(options.summary?.join('\n') ?? '')
        return { updateItems(items) { options.items = items }, updateSummary(lines) { options.summary = lines } }
      },
      showInlineInput(options) { input = options },
      showNotice(text) { screens.push(text) },
      clearInlineControl() {},
    }
    const panel = new PluginPanel({ manager: ctx.pluginManager, host,
      blocker: () => undefined, reload: async () => { throw new Error('Unexpected reload') },
      tools: () => ctx.tools.schemas(handle.agent),
      subscribe(log, state) {
        const offLog = ctx.on('plugin-manager/install-log', log)
        const offState = ctx.on('plugin-manager/install-state', state)
        return () => { offLog(); offState() }
      },
    })
    const wait = async predicate => {
      const until = Date.now() + 45000
      while (!predicate()) {
        if (Date.now() > until) throw new Error(`Timed out: ${JSON.stringify(selector)}; screens=${JSON.stringify(screens)}`)
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    const select = value => {
      assert(selector.items.some(item => item.value === value), `Missing action ${value}: ${JSON.stringify(selector)}`)
      selector.onSelect(value)
    }
    const hasTool = () => ctx.tools.schemas(handle.agent).some(tool => tool.name === 'plugin_panel_ping')
    const bundleName = '@dsh-code-test/plugin-panel'
    try {
      await panel.show()
      if (process.env.PLUGIN_PANEL_PHASE === 'install') {
        select('action:install')
        input.onSubmit(process.env.PLUGIN_PANEL_BUNDLE)
        await wait(() => selector.items.some(item => item.value === 'enable'))
        select('enable')
        await wait(() => !panel.busy)
        assert.equal(stripVTControlCharacters(selector.summary[0]), '✓ Change applied', JSON.stringify(selector.summary))
        assert(hasTool(), 'Installed tool is not visible to the current Standard Agent')
        const execution = await ctx.tools.execute({ name: 'plugin_panel_ping', arguments: {},
          signal: new AbortController().signal, callId: 'plugin-panel-ping-smoke', agent: handle.agent })
        assert(!execution.isError, JSON.stringify(execution))
        assert(execution.content.some(block => block.type === 'text' && block.text === 'pong'))
        // Disable and re-enable through the public panel controls before restart.
        await panel.show()
        selector.onToggle(bundleName)
        await wait(() => !panel.busy)
        assert(!hasTool(), 'Disabled tool remains visible')
        await panel.show()
        selector.onToggle(bundleName)
        await wait(() => !panel.busy)
        assert(hasTool(), 'Re-enabled tool is unavailable')
      } else {
        assert(hasTool(), 'Installed tool was lost after profile initialization / restart')
        select(bundleName)
        await wait(() => selector.items.some(item => item.value === 'remove'))
        select('remove')
        select('remove')
        await wait(() => !panel.busy)
        assert.equal(stripVTControlCharacters(selector.summary[0]), '✓ Change applied', JSON.stringify(selector.summary))
        assert(!hasTool(), 'Removed tool remains visible')
        assert(!(await ctx.pluginManager.listBundles()).some(bundle => bundle.name === bundleName))
      }
      process.stdout.write(JSON.stringify({ phase: process.env.PLUGIN_PANEL_PHASE, toolVisible: hasTool(), screens }) + '\n')
    } finally {
      await panel.dispose()
      await handle.dispose()
    }
    ctx.get('appExit')?.(0)
  })().catch(error => {
    process.stderr.write(`${error.stack ?? error}\n`)
    ctx.get('appExit')?.(1)
  })
}
