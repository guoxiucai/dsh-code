/**
 * dsh-code terminal host plugin. Mounted as the profile's single composition
 * row over dsh-base, it creates (or resumes) one agent, renders its Session
 * events through the pure reducer, and drives input back through the public
 * Agent handle. It owns no agent semantics and imports no Agent Loop internals.
 * @module dsh-code/tui/plugin
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
// Empty type imports declaration-merge `agentDefaultModel`, `cmdlineArgs`, and
// `appExit` onto Context (same contract the upstream headless runner relies on).
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// Declaration-merges the `approval/request` waterfall onto the Cordis Events.
import type {} from '@deepseek-ai/dsh-user-approval'
// Declaration-merges the `commands` service onto Context.
import type {} from '@deepseek-ai/dsh-commands'
import { TuiHost } from './host.ts'
import { reduceSessionEvent, replayEvents, type ReducerState } from './reducer.ts'

/** Stable Cordis plugin name (referenced by id in the profile patch). */
export const name = 'dsh-code-tui'

/** Core services required before a turn can be driven. */
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'commands', 'llm', 'credentials', 'settings']

/** Render coalescing window (ms): stream chunks merge, UI refreshes at most ~60fps. */
const RENDER_INTERVAL_MS = 16

/** Parse a leading `--resume <id>` from the invocation's inner args. */
function parseResumeArg(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--resume' && index + 1 < args.length) return args[index + 1]
  }
  return undefined
}

/** The whole-plugin run loop, detached so a boot failure reports and exits. */
async function run(ctx: Context): Promise<void> {
  const loader = ctx.get('loader')
  await loader?.await()

  const agents = ctx.agents
  const defaultModel = ctx.agentDefaultModel
  const sessions = ctx.sessions
  const innerArgs = ctx.cmdlineArgs?.get() ?? []
  const resumeId = parseResumeArg(innerArgs)
  const selection = defaultModel.currentSelection()
  const modelOptions = { provider: selection.provider, model: selection.model }

  // Surface the model configuration without a network round trip: the current
  // selection plus the provider routes the composition knows about.
  ctx.commands.register({
    name: 'model',
    description: 'Show the current model and the available provider routes',
    handler: () => {
      const current = defaultModel.currentSelection()
      const providers = ctx.llm.listProviders().map(provider => provider.id).join(', ')
      return { kind: 'success', text: `model ${current.provider}/${current.model}; providers: ${providers}` }
    },
  })
  const setup = (agentCtx: Context): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }

  // A requested `--resume` loads the persisted session through the upstream
  // factory; otherwise a fresh session is created. Both return an owned handle.
  const handle = resumeId !== undefined
    ? await agents.resume({ resumeSessionId: SessionId(resumeId), agentOptions: modelOptions, setup })
    : await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: modelOptions,
      setup,
    })
  const agent = handle.agent

  // Rebuild the transcript from the session's full log (persisted history for a
  // resume, empty for a fresh session); the live listener continues from the
  // persisted seq boundary, with the reducer's seq dedup guarding any overlap.
  let reducer: ReducerState = replayEvents(String(agent.session.id), agent.session.events)
  let shuttingDown = false
  let renderTimer: ReturnType<typeof setTimeout> | undefined

  const host = new TuiHost({
    onSubmit: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return
      host.addHistory(text)
      host.clearEditor()
      // A leading slash is a slash command, executed without a model round trip.
      if (trimmed.startsWith('/')) {
        const controller = new AbortController()
        void ctx.commands.execute(agent, trimmed, controller.signal).then(
          (result) => { if (result === undefined) host.showNotice(`unknown command: ${trimmed}`) },
          () => { host.showNotice(`command failed: ${trimmed}`) },
        )
        return
      }
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: trimmed }],
        source: { kind: 'user' },
      }))
    },
    onCancel: () => {
      if (agent.status === 'running') agent.cancel({ kind: 'user' })
      else if (host.getText() !== '') host.clearEditor()
      else void shutdown(0)
    },
    onExit: () => {
      if (agent.status !== 'running') void shutdown(0)
    },
    onRedraw: () => {
      host.tui.invalidate()
      host.tui.requestRender(true)
    },
  })
  host.setModel({ provider: selection.provider, model: selection.model })

  // Three-step model configuration wizard (DeepSeek / OpenAI / compatible).
  // Writes through the upstream settings + credentials services, never a second
  // store. OpenAI-compatible routes land in the pi-ai adapter's `providers` dict.
  const runConfigWizard = async (): Promise<void> => {
    const provider = await host.askChoice('Configure which provider?', [
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'compatible', label: 'OpenAI-compatible' },
    ])
    if (provider === undefined) return

    if (provider === 'deepseek') {
      const key = await host.askText('DeepSeek API key (stored owner-only in ~/.dsh-code/.credentials.yaml):')
      if (key === undefined || key === '') return
      await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), key)
      const model = await host.askChoice('Default model:', [
        { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash' },
        { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
      ])
      if (model === undefined) return
      await ctx.settings.update(settingsNamespace('agent-default-model'), { provider: 'deepseek-official', model })
      host.showNotice(`configured DeepSeek; default model ${model}`)
      return
    }

    const isOpenai = provider === 'openai'
    const id = isOpenai ? 'openai' : await host.askText('Provider route id (e.g. mygateway):')
    if (id === undefined || id === '') return
    const baseURL = isOpenai ? 'https://api.openai.com/v1' : await host.askText('Base URL (e.g. https://api.example.com/v1):')
    if (baseURL === undefined || baseURL === '') return
    const keyEnv = isOpenai ? 'OPENAI_API_KEY' : await host.askText('Credential env-var name (e.g. MYGATEWAY_API_KEY):')
    if (keyEnv === undefined || keyEnv === '') return
    const key = await host.askText(`${isOpenai ? 'OpenAI' : 'Provider'} API key (stored owner-only):`)
    if (key === undefined || key === '') return
    const model = await host.askText('Model id (e.g. gpt-4o):')
    if (model === undefined || model === '') return
    await ctx.credentials.set(credentialRef(keyEnv), key)
    const current = ctx.settings.get(settingsNamespace('llm-pi-ai')) as { providers?: Record<string, unknown> } | undefined
    const providers = { ...(current?.providers ?? {}) }
    providers[id] = { apiKeyEnv: keyEnv, baseURL, api: 'openai-completions', models: [{ id: model }] }
    await ctx.settings.replace(settingsNamespace('llm-pi-ai'), { providers })
    await ctx.settings.update(settingsNamespace('agent-default-model'), { provider: id, model })
    host.showNotice(`configured ${id}; default model ${model} (restart to reload the provider catalog)`)
  }

  ctx.commands.register({
    name: 'config',
    description: 'Configure a model provider (DeepSeek / OpenAI / OpenAI-compatible)',
    handler: () => {
      void runConfigWizard()
      return { kind: 'success', text: 'starting model configuration…' }
    },
  })

  const scheduleRender = (): void => {
    if (renderTimer !== undefined) return
    renderTimer = setTimeout(() => {
      renderTimer = undefined
      host.render(reducer)
    }, RENDER_INTERVAL_MS)
  }

  const syncDraft = (): void => {
    const draft = reducer.draftAssistant
    host.setDraft(draft === undefined ? undefined : { text: draft.text, reasoning: draft.reasoning })
  }

  const disposeEvents = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    try {
      reducer = reduceSessionEvent(reducer, event)
    } catch (error) {
      // A sequence gap or an unknown required event: stop rendering and report.
      host.stop()
      process.stderr.write(`dsh-code: ${error instanceof Error ? error.message : String(error)}\n`)
      ctx.appExit?.(1)
      return
    }
    syncDraft()
    scheduleRender()
  })

  const disposeStatus = ctx.on('agent/status', (payload: { agent: Agent; status: 'idle' | 'running' }) => {
    if (payload.agent !== agent) return
    scheduleRender()
  })

  // Permission answerer: a one-shot Allow/Reject overlay for this agent's tool
  // calls. Never infers a durable grant; Esc/cancel settles as `cancelled`.
  const disposeApproval = ctx.on('approval/request', (request, next) => {
    if (request.agent !== agent) return next()
    const question = request.reason !== undefined && request.reason !== ''
      ? `Allow \`${request.toolName}\`?\n${request.reason}`
      : `Allow \`${request.toolName}\`?`
    return host.askChoice(question, [
      { value: 'allowed-once', label: 'Allow once' },
      { value: 'rejected', label: 'Reject' },
    ]).then(value => value === 'allowed-once' ? 'allowed-once' : value === 'rejected' ? 'rejected' : 'cancelled')
  })

  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    host.stop()
    disposeEvents()
    disposeStatus()
    disposeApproval()
    try {
      await agent.whenIdle()
      await sessions.flush(agent.session)
    } catch {
      // Best-effort: the tree disposal below still reaches quiescence.
    }
    ctx.appExit?.(code)
  }

  host.render(reducer)
  host.start()
}

/**
 * Mount the terminal host. Boot is detached; a failure (missing service,
 * invalid selection) reports to stderr and requests a failing exit.
 */
export function apply(ctx: Context): void {
  void run(ctx).catch((error: unknown) => {
    process.stderr.write(`dsh-code: ${error instanceof Error ? error.message : String(error)}\n`)
    ctx.appExit?.(1)
  })
}
