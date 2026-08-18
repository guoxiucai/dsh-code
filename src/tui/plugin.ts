/**
 * dsh-code terminal host plugin. Mounted as the profile's single composition
 * row over dsh-base, it creates (or resumes) one agent, renders its Session
 * events through the pure reducer, and drives input back through the public
 * Agent handle. It owns no agent semantics and imports no Agent Loop internals.
 * @module dsh-code/tui/plugin
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
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
// Declaration-merges the `shell` service onto Context.
import type {} from '@deepseek-ai/dsh-shell'
// Declaration-merges the `approval/request` waterfall onto the Cordis Events.
import type {} from '@deepseek-ai/dsh-user-approval'
// Declaration-merges the `commands` service onto Context.
import type {} from '@deepseek-ai/dsh-commands'
// Declaration-merges the `permissionPresets` service onto Context.
import type {} from '@deepseek-ai/dsh-permission-presets'
// Declaration-merges the `tokenMeter` service onto Context.
import type {} from '@deepseek-ai/dsh-token-meter'
import { TuiHost } from './host.ts'
import { reduceSessionEvent, replayEvents, type ReducerState } from './reducer.ts'
import { theme } from './theme.ts'
import { addMcpServer, removeMcpServer } from './project-config.ts'
import { credentialEnvName } from './config-wizard.ts'

/** Stable Cordis plugin name (referenced by id in the profile patch). */
export const name = 'dsh-code-tui'

/** Core services required before a turn can be driven. */
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'commands', 'llm', 'credentials', 'settings', 'permissionPresets', 'shell', 'tokenMeter']

/** Render coalescing window (ms): stream chunks merge, UI refreshes at most ~60fps. */
const RENDER_INTERVAL_MS = 16

/** Parse a leading `--resume <id>` from the invocation's inner args. */
function parseResumeArg(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--resume' && index + 1 < args.length) return args[index + 1]
  }
  return undefined
}

/**
 * Read the current git branch from `.git/HEAD` without spawning git. Handles a
 * plain worktree (`.git` is a directory) and a linked worktree/submodule (`.git`
 * is a file pointing at the gitdir). Returns undefined when not a git worktree
 * or on a detached HEAD.
 */
function detectGitBranch(cwd: string): string | undefined {
  try {
    const dotGit = join(cwd, '.git')
    let headPath: string
    const stat = statSync(dotGit)
    if (stat.isDirectory()) {
      headPath = join(dotGit, 'HEAD')
    } else if (stat.isFile()) {
      const content = readFileSync(dotGit, 'utf8')
      const gitdir = content.match(/^gitdir:\s*(.+)$/m)
      if (gitdir === null || gitdir[1] === undefined) return undefined
      headPath = join(cwd, gitdir[1].trim(), 'HEAD')
    } else {
      return undefined
    }
    return readFileSync(headPath, 'utf8').match(/^ref: refs\/heads\/(.+)$/m)?.[1]?.trim()
  } catch {
    return undefined
  }
}

/** Read dsh-code's own version from its checked-in package.json (never the network). */
function readVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
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
  const modelRef: ModelSelectionRef = { current: { provider: selection.provider, model: selection.model }, assembled: undefined }

  const setup = (agentCtx: Context): void => {
    installModelSelection(agentCtx, modelRef)
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
      // `!` prefix runs a shell command directly (never sent to the model).
      if (trimmed.startsWith('!')) {
        const command = trimmed.startsWith('!!') ? trimmed.slice(2).trim() : trimmed.slice(1).trim()
        if (command !== '') void runShellCommand(command)
        return
      }
      // `/permission` with no argument opens the preset selector.
      if (trimmed === '/permission') {
        void runPermissionPicker()
        return
      }
      // A leading slash is a slash command, executed without a model round trip.
      if (trimmed.startsWith('/')) {
        const controller = new AbortController()
        void ctx.commands.execute(agent, trimmed, controller.signal).then(
          (execution) => {
            if (execution === undefined) { host.showNotice(`unknown command: ${trimmed}`); return }
            const result = execution.result
            if (result.kind === 'success') {
              if (result.text !== undefined && result.text !== '') host.showNotice(result.text)
            } else {
              host.showNotice(`command failed: ${result.text}`)
            }
          },
          (error: unknown) => {
            host.showNotice(`command failed: ${error instanceof Error ? error.message : trimmed}`)
          },
        )
        return
      }
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: trimmed }],
        source: { kind: 'user' },
      }))
    },
    onEditorChange: (text) => {
      host.setShellMode(text.trimStart().startsWith('!'))
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
  host.setProject(basename(process.cwd()), detectGitBranch(process.cwd()))
  host.setVersion(readVersion())

  // Direct shell execution (`!` prefix), bypassing the model loop.
  const runShellCommand = async (command: string): Promise<void> => {
    const result = await ctx.shell.run(ctx.shell.resolve({ command }))
    const output = [result.stdout.text.trim(), result.stderr.text.trim()].filter(Boolean).join('\n')
    const status = result.timedOut ? 'timed out'
      : result.aborted ? 'aborted'
        : result.signal !== null ? `killed by ${result.signal}`
          : result.exitCode !== 0 && result.exitCode !== null ? `exit ${result.exitCode}`
            : ''
    host.showShellResult(command, output, status)
  }

  // Permission preset selector (`/permission` with no argument).
  const runPermissionPicker = (): void => {
    const presets = ctx.permissionPresets.names
    const current = ctx.permissionPresets.current(agent.session.events)
    host.showSelector({
      hint: 'Select a permission preset.',
      borderColor: theme.selectorBorder,
      items: presets.map(name => ({ value: name, label: name, current: name === current })),
      onSelect: (name) => {
        ctx.permissionPresets.set(agent.session, name)
        host.showNotice(`permission set to ${name}`)
      },
      onCancel: () => {},
    })
  }

  // Model picker: list available models and switch the live selection (plus the
  // persisted default for future sessions).
  const runModelPicker = async (searchTerm: string): Promise<void> => {
    const models: { provider: string; model: string }[] = []
    for (const provider of ctx.llm.listProviders()) {
      for (const model of await ctx.llm.listModels(provider.id)) {
        models.push({ provider: provider.id, model: model.id })
      }
    }
    const current = defaultModel.currentSelection()
    const isCurrent = (entry: { provider: string; model: string }): boolean =>
      entry.provider === current.provider && entry.model === current.model
    const sorted = [...models].sort((a, b) => {
      if (isCurrent(a) !== isCurrent(b)) return isCurrent(a) ? -1 : 1
      return `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`)
    })
    host.showSelector({
      hint: 'Only showing models from configured providers.',
      borderColor: theme.selectorBorder,
      items: sorted.map(entry => ({
        value: `${entry.provider}\u0000${entry.model}`,
        label: `${entry.model} [${entry.provider}]`,
        description: entry.model,
        current: isCurrent(entry),
      })),
      onSelect: async (value) => {
        const [provider, model] = value.split('\u0000')
        if (provider === undefined || model === undefined) return
        modelRef.current = { provider, model }
        host.setModel({ provider, model })
        await ctx.settings.update(settingsNamespace('agent-default-model'), { provider, model })
        host.showNotice(`switched to ${provider}/${model} (applies to new turns)`)
      },
      onCancel: () => {},
    })
    void searchTerm
  }

  ctx.commands.register({
    name: 'model',
    description: 'Select model (opens selector UI)',
    input: { hint: '<provider/model>' },
    handler: ({ rawInput }) => {
      void runModelPicker(rawInput.trim())
      return { kind: 'success' }
    },
  })

  // Slash-command autocomplete, refreshed whenever the command registry changes.
  // `fd` (when installed) enables the fast fuzzy file search; `/permission`
  // completes its preset names from the permission-presets service.
  const findFd = (): string | undefined => {
    for (const dir of (process.env.PATH ?? '').split(':')) {
      const candidate = join(dir, 'fd')
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        // Skip non-existent entries.
      }
    }
    return undefined
  }

  const syncCommands = (): void => {
    const fdPath = findFd()
    const presets = ctx.permissionPresets.names
    host.setAutocomplete(ctx.commands.list(agent).map(command => ({
      name: command.name,
      description: command.description,
      ...(command.input !== undefined ? { argumentHint: command.input.hint } : {}),
      ...(command.name === 'permission'
        ? {
          getArgumentCompletions: (prefix: string) => presets
            .filter(name => name.startsWith(prefix))
            .map(name => ({ value: name, label: name })),
        }
        : {}),
    })), process.cwd(), fdPath)
  }
  syncCommands()
  const disposeCommandsChange = ctx.on('commands/change', () => { syncCommands() })

  // Model configuration wizard (DeepSeek / OpenAI / compatible). Every step is
  // mounted inline; Enter advances and Esc rebuilds the preceding step. Values
  // are written only after the final step, so backing out never leaves a partial
  // provider configuration. OpenAI-compatible routes land in pi-ai's providers.
  const showConfigError = (error: unknown): void => {
    host.showNotice(`configuration failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  type ConfigProvider = 'deepseek' | 'openai' | 'compatible'
  interface ConfigDraft {
    provider: ConfigProvider
    id?: string
    baseURL?: string
    keyEnv?: string
    keyEnvCustomized?: boolean
    key?: string
    model?: string
  }

  const saveConfig = async (draft: ConfigDraft): Promise<void> => {
    if (draft.key === undefined || draft.model === undefined) return
    if (draft.provider === 'deepseek') {
      await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), draft.key)
      await ctx.settings.update(settingsNamespace('agent-default-model'), {
        provider: 'deepseek-official',
        model: draft.model,
      })
      host.showNotice(`configured DeepSeek; default model ${draft.model}`)
      return
    }
    if (draft.id === undefined || draft.baseURL === undefined || draft.keyEnv === undefined) return
    await ctx.credentials.set(credentialRef(draft.keyEnv), draft.key)
    const current = ctx.settings.get(settingsNamespace('llm-pi-ai')) as { providers?: Record<string, unknown> } | undefined
    const providers = { ...(current?.providers ?? {}) }
    providers[draft.id] = {
      apiKeyEnv: draft.keyEnv,
      baseURL: draft.baseURL,
      api: 'openai-completions',
      models: [{ id: draft.model }],
    }
    await ctx.settings.replace(settingsNamespace('llm-pi-ai'), { providers })
    await ctx.settings.update(settingsNamespace('agent-default-model'), { provider: draft.id, model: draft.model })
    host.showNotice(`configured ${draft.id}; default model ${draft.model} (restart to reload the provider catalog)`)
  }

  const showProviderSelector = (): void => {
    host.showSelector({
      hint: 'Select a model provider to configure.',
      borderColor: theme.selectorBorder,
      items: [
        { value: 'deepseek', label: 'DeepSeek', description: 'DeepSeek official API' },
        { value: 'openai', label: 'OpenAI', description: 'OpenAI official API' },
        { value: 'compatible', label: 'OpenAI-compatible', description: 'Custom OpenAI-compatible endpoint' },
      ],
      onSelect: (provider) => {
        const draft: ConfigDraft = { provider: provider as ConfigProvider }
        if (draft.provider === 'deepseek') showApiKeyInput(draft)
        else if (draft.provider === 'openai') {
          draft.id = 'openai'
          draft.baseURL = 'https://api.openai.com/v1'
          draft.keyEnv = 'OPENAI_API_KEY'
          showApiKeyInput(draft)
        } else {
          showRouteIdInput(draft)
        }
      },
      onCancel: () => {},
    })
  }

  const showRouteIdInput = (draft: ConfigDraft): void => {
    host.showInlineInput({
      prompt: 'Provider ID (e.g. deepseek):',
      initialValue: draft.id,
      borderColor: theme.selectorBorder,
      onSubmit: (id) => {
        draft.id = id
        if (draft.keyEnvCustomized !== true) draft.keyEnv = credentialEnvName(id)
        showBaseUrlInput(draft)
      },
      onCancel: showProviderSelector,
    })
  }

  const showBaseUrlInput = (draft: ConfigDraft): void => {
    host.showInlineInput({
      prompt: 'Base URL (e.g. https://api.deepseek.com):',
      initialValue: draft.baseURL,
      borderColor: theme.selectorBorder,
      onSubmit: (baseURL) => { draft.baseURL = baseURL; showKeyEnvInput(draft) },
      onCancel: () => { showRouteIdInput(draft) },
    })
  }

  const showKeyEnvInput = (draft: ConfigDraft): void => {
    // Recompute at the point of display as a defensive fallback: this field is
    // always a real prefilled value, never merely an example in the prompt.
    const suggested = draft.keyEnv ?? credentialEnvName(draft.id ?? 'provider')
    draft.keyEnv = suggested
    host.showInlineInput({
      prompt: 'Credential env-var name (e.g. DEEPSEEK_API_KEY):',
      hint: 'Auto-generated from Provider ID · Enter to accept or edit · Esc to go back',
      initialValue: suggested,
      borderColor: theme.selectorBorder,
      onSubmit: (keyEnv) => {
        draft.keyEnv = keyEnv
        draft.keyEnvCustomized = true
        showApiKeyInput(draft)
      },
      onCancel: () => { showBaseUrlInput(draft) },
    })
  }

  const showApiKeyInput = (draft: ConfigDraft): void => {
    const label = draft.provider === 'deepseek' ? 'DeepSeek' : draft.provider === 'openai' ? 'OpenAI' : 'Provider'
    const example = draft.provider === 'compatible' ? ' (DeepSeek example: sk-...)' : ''
    host.showInlineInput({
      prompt: `${label} API key${example} (stored owner-only in ~/.dsh-code/.credentials.yaml):`,
      initialValue: draft.key,
      borderColor: theme.selectorBorder,
      onSubmit: (key) => {
        draft.key = key
        if (draft.provider === 'deepseek') showDeepSeekModelSelector(draft)
        else showModelInput(draft)
      },
      onCancel: () => {
        if (draft.provider === 'compatible') showKeyEnvInput(draft)
        else showProviderSelector()
      },
    })
  }

  const showDeepSeekModelSelector = (draft: ConfigDraft): void => {
    host.showSelector({
      hint: 'Select the default DeepSeek model.',
      borderColor: theme.selectorBorder,
      items: [
        { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash', description: 'Fast default model' },
        { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro', description: 'Higher-capability model' },
      ],
      onSelect: (model) => { draft.model = model; void saveConfig(draft).catch(showConfigError) },
      onCancel: () => { showApiKeyInput(draft) },
    })
  }

  const showModelInput = (draft: ConfigDraft): void => {
    host.showInlineInput({
      prompt: 'Model ID (e.g. deepseek-chat):',
      initialValue: draft.model,
      borderColor: theme.selectorBorder,
      onSubmit: (model) => { draft.model = model; void saveConfig(draft).catch(showConfigError) },
      onCancel: () => { showApiKeyInput(draft) },
    })
  }

  ctx.commands.register({
    name: 'config',
    description: 'Configure a model provider (DeepSeek / OpenAI / OpenAI-compatible)',
    handler: () => {
      showProviderSelector()
      return { kind: 'success' }
    },
  })

  // MCP configuration: add a stdio or Streamable HTTP server to the project's
  // `.dsh-code/cordis.patch.yml` (loaded on the next launch via --patch).
  const runMcpWizard = async (): Promise<void> => {
    const transport = await host.askChoice('MCP transport:', [
      { value: 'stdio', label: 'stdio (local command)' },
      { value: 'streamable-http', label: 'Streamable HTTP (remote)' },
    ])
    if (transport === undefined) return
    const serverName = await host.askText('Server name (namespace for mcp__<name>__ tools):')
    if (serverName === undefined || serverName === '') return
    if (transport === 'stdio') {
      const command = await host.askText('Command (e.g. npx):')
      if (command === undefined || command === '') return
      const argsText = await host.askText('Arguments (space-separated, e.g. -y some-mcp-server):')
      addMcpServer(process.cwd(), { serverName, transport: 'stdio', command, args: (argsText ?? '').split(/\s+/).filter(Boolean) })
      host.showNotice(`added MCP server ${serverName} (restart dsh-code to connect)`)
    } else {
      const url = await host.askText('Server URL (e.g. https://mcp.example.com/mcp):')
      if (url === undefined || url === '') return
      addMcpServer(process.cwd(), { serverName, transport: 'streamable-http', url })
      host.showNotice(`added MCP server ${serverName} (restart dsh-code to connect)`)
    }
  }

  ctx.commands.register({
    name: 'mcp',
    description: 'Configure an MCP server (add / remove)',
    handler: ({ rawInput }) => {
      const [sub, name] = rawInput.trim().split(/\s+/)
      if (sub === undefined || sub === 'add') {
        void runMcpWizard()
        return { kind: 'success', text: 'starting MCP configuration…' }
      }
      if (sub === 'remove') {
        if (name === undefined) return { kind: 'error', text: 'usage: /mcp remove <serverName>' }
        removeMcpServer(process.cwd(), name)
        return { kind: 'success', text: `removed MCP server ${name}` }
      }
      return { kind: 'error', text: `unknown /mcp subcommand "${sub}"` }
    },
  })

  // Current-session info (no in-session switching) + fork over the upstream seams.
  ctx.commands.register({
    name: 'session',
    description: 'Show current session info and stats',
    handler: () => {
      const events = agent.session.events
      const header = agent.session.header
      const user = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length
      const assistant = events.filter(event => event.type === 'assistant/message').length
      const toolCalls = events.filter(event => event.type === 'tool/call').length
      const toolResults = events.filter(event => event.type === 'tool/result').length
      const usage = reducer.tokenUsage
      const input = usage?.inputTokens ?? 0
      const cacheRead = usage?.cacheReadTokens ?? 0
      const cacheWrite = usage?.cacheWriteTokens ?? 0
      const output = usage?.outputTokens ?? 0
      const reasoning = usage?.reasoningTokens ?? 0
      const promptTokens = input + cacheRead + cacheWrite
      const lines = [
        'Session Info',
        '',
        `ID: ${String(header.id)}`,
        `cwd: ${header.cwd ?? ''}`,
        `created: ${new Date(header.createdAt).toLocaleString()}`,
        ...(header.parentSession !== undefined ? [`parent: ${String(header.parentSession)}`] : []),
        `model: ${selection.provider}/${selection.model}`,
        '',
        'Messages',
        `user: ${user}`,
        `assistant: ${assistant}`,
        `tools: ${toolCalls} calls, ${toolResults} results`,
        '',
        'Tokens',
        `input: ${promptTokens.toLocaleString()}`,
      ]
      if (promptTokens > 0 && (cacheRead > 0 || cacheWrite > 0)) {
        const hitRate = (cacheRead / promptTokens) * 100
        lines.push(`  cached: ${cacheRead.toLocaleString()} (${hitRate.toFixed(1)}%)`)
        lines.push(`  uncached: ${(input + cacheWrite).toLocaleString()}${cacheWrite > 0 ? ` (${cacheWrite.toLocaleString()} written)` : ''}`)
      }
      lines.push(`output: ${output.toLocaleString()}`)
      if (reasoning > 0) lines.push(`  thinking: ${reasoning.toLocaleString()}`)
      lines.push(`total: ${(promptTokens + output).toLocaleString()}`)
      return { kind: 'success', text: lines.join('\n') }
    },
  })

  ctx.commands.register({
    name: 'fork',
    description: 'Fork the current session at the last completed turn',
    handler: async () => {
      const boundary = agent.session.events.findLast(event => event.type === 'turn/end')?.seq
      if (boundary === undefined) return { kind: 'error', text: 'no completed turn to fork at' }
      try {
        const child = ctx.sessions.fork(agent.session, boundary, SessionId(`session-${randomUUID()}`))
        await ctx.sessions.flush(child)
        return { kind: 'success', text: `forked to ${child.id} (resume: dsh-code resume ${child.id})` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  const scheduleRender = (): void => {
    if (renderTimer !== undefined) return
    renderTimer = setTimeout(() => {
      renderTimer = undefined
      host.setContextTokens(ctx.tokenMeter.measure(agent.session).totalTokens)
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
    // Drop any pending render tick: it would fire after `appExit` disposes the
    // context and read `ctx.tokenMeter` from an inactive context.
    if (renderTimer !== undefined) {
      clearTimeout(renderTimer)
      renderTimer = undefined
    }
    host.stop()
    disposeEvents()
    disposeStatus()
    disposeApproval()
    disposeCommandsChange()
    try {
      await sessions.flush(agent.session)
    } catch {
      // Best-effort: owned-handle disposal below still drains the agent tree.
    }
    try {
      // We own the handle returned by agents.create/resume. Dispose it through
      // the public upstream seam so a stale/racing activity cannot strand exit.
      await handle.dispose()
    } catch {
      // appExit still tears down the remaining composition tree.
    }
    ctx.appExit?.(code)
  }

  // Exit the session from a slash command — the same path as Ctrl+D when idle.
  for (const exitCommand of ['quit', 'exit'] as const) {
    ctx.commands.register({
      name: exitCommand,
      description: 'Exit the current session',
      handler: () => {
        if (agent.status === 'running') return { kind: 'error', text: 'cancel the active turn before exiting (Ctrl+C)' }
        void shutdown(0)
        // No success text: the exit signal is transient, not a durable
        // transcript notice — a persisted "exiting…" would replay on every
        // resume and accumulate across resume/exit cycles.
        return { kind: 'success' }
      },
    })
  }

  host.setContextTokens(ctx.tokenMeter.measure(agent.session).totalTokens)
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
