/**
 * dsh-code terminal host plugin. Mounted as the profile's single composition
 * row over dsh-base, it creates (or resumes) one agent, renders its Session
 * events through the pure reducer, and drives input back through the public
 * Agent handle. It owns no agent semantics and imports no Agent Loop internals.
 * @module dsh-code/tui/plugin
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
// Declaration-merges the upstream Agent Preset roster onto Context.
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
// Empty type imports declaration-merge `agentDefaultModel`, `cmdlineArgs`, and
// `appExit` onto Context (same contract the upstream headless runner relies on).
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  UserQuestionError,
  type AskUserQuestionAnswer,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
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
// Declaration-merges the live Tool Registry used for MCP connection status.
import type {} from '@deepseek-ai/dsh-tools'
// Declaration-merges the host services used by the richer TUI commands.
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { SkillProviderControl, SkillSummary } from '@deepseek-ai/dsh-skill'
import type {
  SubagentDescendantListEntry,
  SubagentRunEndInfo,
  SubagentRunInfo,
} from '@deepseek-ai/dsh-subagent'
import type { JobId, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-session-title'
// Declaration-merges the project/session query service onto Context.
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import { TuiHost } from './host.ts'
import type { SelectorHandle, SelectorItem } from './selector.ts'
import { reduceSessionEvent, replayEvents, type ReducerState } from './reducer.ts'
import { theme } from './theme.ts'
import { parseMcpArguments, type McpServerConfig } from './project-config.ts'
import {
  discoverExternalMcpServers,
  externalMcpLocation,
  externalMcpSourceLabel,
  type DiscoveredMcpServer,
} from './external-mcp.ts'
import {
  removeMcpServer,
  setMcpServerEnabled,
  upsertMcpServer,
  type ImportedMcpOrigin,
  type McpConfigScope,
  type StoredMcpServer,
} from './mcp-config.ts'
import { cordisMcpMount, McpRuntimeManager, type McpRuntimeSnapshot } from './mcp-runtime.ts'
import {
  installDisabledSkillProvider,
  readDisabledSkills,
  writeDisabledSkills,
  type DisabledSkillRecord,
} from './skill-preferences.ts'
import { credentialEnvName } from './config-wizard.ts'
import { FIRST_MODEL_CONFIG_ENV } from '../bootstrap/credentials.ts'
import {
  AGENT_MODE_ENV,
  AGENT_MODE_OPTIONS,
  DEFAULT_AGENT_MODE,
  agentModeForPreset,
  parseAgentMode,
  presetForAgentMode,
  sessionCanSwitchMode,
  type AgentMode,
  type SupportedAgentPreset,
} from '../agent-mode.ts'
import {
  defaultExportFilename,
  exportFormatForPath,
  writeSessionExport,
  type SessionExportFormat,
} from './session-export.ts'
import { buildSessionTreeRows, sessionSwitchBlocker } from './session-tree.ts'
import { sendSessionSwitch } from '../session-switch.ts'

/** Stable Cordis plugin name (referenced by id in the profile patch). */
export const name = 'dsh-code-tui'

/** Core services required before a turn can be driven. */
export const inject = ['agents', 'agentPresets', 'agentDefaultModel', 'sessions', 'sessionQuery', 'commands', 'llm', 'credentials', 'settings', 'permissionPresets', 'shell', 'tokenMeter', 'userQuestions', 'goals', 'skills', 'subagents', 'jobs', 'sessionTitle', 'tools']

/** Stream coalescing window: assistant chunks render at most about 30fps. */
export const STREAM_RENDER_INTERVAL_MS = 33

/** Draft deltas do not change TokenMeter's durable, model-visible surface. */
export function shouldMeasureContextTokens(eventType: string): boolean {
  return eventType !== 'assistant/chunk'
}

/** Current subagent-list projection seam (refined by live lifecycle state). */
export function subagentEntriesForList(
  entries: readonly SubagentDescendantListEntry[],
  activeIds: ReadonlySet<string>,
  dismissedIds: ReadonlySet<string> = new Set(),
): readonly SubagentDescendantListEntry[] {
  return entries.filter(entry => entry.kind === 'child'
    && activeIds.has(String(entry.id))
    && !dismissedIds.has(String(entry.id)))
}

/** Count unique active child sessions directly from lifecycle edges. */
export function activeSubagentCount(
  activeRuns: ReadonlyMap<string, string>,
  dismissedIds: ReadonlySet<string> = new Set(),
): number {
  return new Set([...activeRuns.values()].filter(id => !dismissedIds.has(id))).size
}

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
  const requestedMode = parseAgentMode(process.env[AGENT_MODE_ENV] ?? '') ?? DEFAULT_AGENT_MODE
  const requestedPreset = presetForAgentMode(requestedMode)
  const selection = defaultModel.currentSelection()
  const modelOptions = { provider: selection.provider, model: selection.model }
  const modelRef: ModelSelectionRef = { current: { provider: selection.provider, model: selection.model }, assembled: undefined }
  const dshCodeHome = process.env.DSH_HOME ?? join(homedir(), '.dsh-code')
  const disabledSkills = readDisabledSkills(dshCodeHome)
  let disabledSkillControl: SkillProviderControl | undefined
  let activePreset: SupportedAgentPreset = requestedPreset

  const setup = async (agentCtx: Context): Promise<void> => {
    const recorded = agentCtx.agent === undefined ? undefined : resolveSessionPreset(agentCtx.agent.session)
    const preset = resumeId === undefined ? requestedPreset : (recorded ?? 'standard')
    if (preset !== 'standard' && preset !== 'code') {
      throw new Error(`session uses unsupported agent preset ${JSON.stringify(preset)}`)
    }
    activePreset = preset
    await ctx.agentPresets.mount(agentCtx, preset)
    installModelSelection(agentCtx, modelRef)
    await installDisabledSkillProvider(agentCtx, disabledSkills, (control) => { disabledSkillControl = control })
  }

  // A requested `--resume` loads the persisted session through the upstream
  // factory; otherwise a fresh session is created. Both return an owned handle.
  const handle = resumeId !== undefined
    ? await agents.resume({ resumeSessionId: SessionId(resumeId), agentOptions: modelOptions, setup })
    : await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd(), agentPreset: requestedPreset },
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
  let contextTokensDirty = false
  const activeSubagentRuns = new Map<string, string>()
  const dismissedSubagents = new Set<string>()
  let openAgentsPanel: () => void = () => {}
  let modeSwitching = false

  const submitUserText = (text: string): void => {
    if (modeSwitching) {
      host.showNotice('mode switch in progress; send the message after it completes')
      return
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }))
  }

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
      // The upstream /goal remains authoritative for argument forms; the bare
      // command is a TUI management surface over the same public GoalService.
      if (trimmed === '/goal') {
        runGoalPicker()
        return
      }
      // A leading slash is a slash command, executed without a model round trip.
      if (trimmed.startsWith('/')) {
        void runSlashOrSkill(trimmed)
        return
      }
      submitUserText(trimmed)
    },
    onEditorChange: (text) => {
      host.setShellMode(text.trimStart().startsWith('!'))
    },
    onInterrupt: () => {
      if (agent.status === 'running') agent.cancel({ kind: 'user' })
    },
    onExit: () => {
      if (agent.status !== 'running') void shutdown(0)
    },
    onRedraw: () => {
      host.tui.invalidate()
      host.tui.requestRender(true)
    },
    onOpenAgents: () => { openAgentsPanel() },
  })
  host.setModel({ provider: selection.provider, model: selection.model })
  host.setAgentMode(agentModeForPreset(activePreset))
  host.setProject(basename(process.cwd()), detectGitBranch(process.cwd()))
  host.setVersion(readVersion())

  const showCommandError = (label: string, error: unknown): void => {
    host.showNotice(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const mcpRuntime = new McpRuntimeManager({
    home: dshCodeHome,
    cwd: process.cwd(),
    mount: cordisMcpMount(ctx, { stderrLogDir: join(dshCodeHome, 'logs', 'mcp') }),
    toolNames: () => ctx.tools.schemas(agent).map(schema => schema.name),
  })
  ctx.effect(() => async () => { await mcpRuntime.dispose() }, 'dsh-code MCP runtime')

  /** Commands win their closed namespace; unknown names may be DSH user-invocable skills. */
  const runSlashOrSkill = async (input: string): Promise<void> => {
    const controller = new AbortController()
    try {
      // The TUI composer currently submits text only. Upstream 0.1.1 makes the
      // attachment batch explicit so command admission cannot silently discard
      // images when image-capable input is added later.
      const execution = await ctx.commands.execute(agent, input, [], controller.signal)
      if (execution !== undefined) {
        const result = execution.result
        if (result.kind === 'success') {
          if (result.text !== undefined && result.text !== '') host.showNotice(result.text)
        } else {
          host.showNotice(`command failed: ${result.text}`)
        }
        return
      }
      const name = input.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s|$)/)?.[1]
      if (name !== undefined) {
        const skills = await ctx.skills.list({ cwd: process.cwd(), scope: agent, signal: controller.signal })
        const skill = skills.find(candidate => candidate.name === name)
        if (skill?.invocation.userInvocable === true) {
          submitUserText(input)
          return
        }
      }
      host.showNotice(`unknown command or user-invocable skill: ${input}`)
    } catch (error) {
      showCommandError('command', error)
    }
  }

  const goalDescription = (goal: GoalView): string => [
    `${goal.phase}${goal.activation === 'armed' ? ' · armed' : ''}`,
    `rounds ${goal.roundsStarted}/${goal.maxGoalRounds}`,
    goal.objective,
  ].join(' · ')

  const showGoalInput = (current?: GoalView): void => {
    host.showInlineInput({
      prompt: current === undefined ? 'Goal objective:' : 'Edit goal objective:',
      initialValue: current?.objective,
      borderColor: theme.selectorBorder,
      onSubmit: (objective) => {
        try {
          const updated = current === undefined || current.phase === 'complete'
            ? ctx.goals.create(agent, { objective })
            : ctx.goals.edit(agent, { id: current.id, revision: current.revision }, { objective })
          host.showNotice(`goal ${current === undefined || current.phase === 'complete' ? 'created' : 'updated'}: ${updated.objective}`)
        } catch (error) {
          showCommandError('goal update', error)
        }
      },
      onCancel: () => { if (current !== undefined) runGoalPicker() },
    })
  }

  const confirmGoalClear = (current: GoalView): void => {
    host.showSelector({
      hint: `Clear goal: ${current.objective}`,
      borderColor: theme.selectorBorder,
      items: [
        { value: 'clear', label: 'Clear goal' },
        { value: 'cancel', label: 'Keep goal' },
      ],
      onSelect: (choice) => {
        if (choice !== 'clear') { runGoalPicker(); return }
        try {
          ctx.goals.clear(agent, { id: current.id, revision: current.revision })
          host.showNotice('goal cleared')
        } catch (error) {
          showCommandError('goal clear', error)
        }
      },
      onCancel: () => { runGoalPicker() },
    })
  }

  const runGoalPicker = (): void => {
    let current: GoalView | undefined
    try {
      current = ctx.goals.get(agent)
    } catch (error) {
      showCommandError('goal lookup', error)
      return
    }
    if (current === undefined) {
      showGoalInput()
      return
    }
    const items = [
      { value: 'edit', label: current.phase === 'complete' ? 'Create a new goal' : 'Edit objective' },
      ...(current.phase === 'active' ? [{ value: 'pause', label: 'Pause goal' }] : []),
      ...((current.phase === 'paused' || current.phase === 'blocked' || (current.phase === 'active' && current.activation === 'disarmed'))
        ? [{ value: 'resume', label: 'Resume goal' }]
        : []),
      { value: 'clear', label: 'Clear goal' },
    ]
    host.showSelector({
      hint: `Goal · ${goalDescription(current)}`,
      borderColor: theme.selectorBorder,
      items,
      onSelect: (action) => {
        if (action === 'edit') { showGoalInput(current); return }
        if (action === 'clear') { confirmGoalClear(current); return }
        try {
          const ref = { id: current.id, revision: current.revision }
          if (action === 'pause') {
            const updated = ctx.goals.pause(agent, ref)
            host.showNotice(`goal paused: ${updated.objective}`)
          } else if (action === 'resume') {
            const updated = ctx.goals.resume(agent, ref)
            host.showNotice(`goal resumed: ${updated.objective}`)
          }
        } catch (error) {
          showCommandError(`goal ${action}`, error)
        }
      },
      onCancel: () => {},
    })
  }

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
      initialQuery: searchTerm,
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

  const switchAgentMode = async (mode: AgentMode): Promise<void> => {
    const target = presetForAgentMode(mode)
    if (target === activePreset) {
      host.showNotice(`${AGENT_MODE_OPTIONS.find(option => option.mode === mode)?.label ?? mode} mode is already active`)
      return
    }
    if (agent.status !== 'idle' || !sessionCanSwitchMode(agent.session.events)) {
      host.showNotice(`this session is locked to ${agentModeForPreset(activePreset)} after its first turn; start a new one with dsh-code --mode ${mode}`)
      return
    }
    modeSwitching = true
    try {
      await ctx.agentPresets.recompose(agent.ctx, target)
      agent.session.append('agent-preset/selected', { agentPreset: target })
      activePreset = target
      host.setAgentMode(mode)
      syncCommands()
      host.showNotice(`switched this blank session to ${mode === 'ptc' ? 'PTC' : 'Standard'} mode`)
    } catch (error) {
      showCommandError('mode switch', error)
    } finally {
      modeSwitching = false
    }
  }

  const runModePicker = (rawInput: string): void => {
    const requested = rawInput.trim()
    if (requested !== '') {
      const mode = parseAgentMode(requested)
      if (mode === undefined) {
        host.showNotice('/mode expects standard or ptc')
        return
      }
      void switchAgentMode(mode)
      return
    }
    const current = agentModeForPreset(activePreset)
    host.showSelector({
      hint: sessionCanSwitchMode(agent.session.events)
        ? 'Select the mode for this blank session. The choice locks after the first turn.'
        : 'This session mode is locked after its first turn.',
      borderColor: theme.selectorBorder,
      items: AGENT_MODE_OPTIONS.map(option => ({
        value: option.mode,
        label: option.label,
        description: option.description,
        current: option.mode === current,
      })),
      onSelect: (mode) => { void switchAgentMode(mode as AgentMode) },
      onCancel: () => {},
    })
  }

  ctx.commands.register({
    name: 'mode',
    description: 'Select Standard or PTC mode (blank sessions only)',
    input: { hint: '<standard|ptc>' },
    handler: ({ rawInput }) => {
      runModePicker(rawInput)
      return { kind: 'success' }
    },
  })

  const skillLocation = (skill: SkillSummary): string => {
    const base = skill.resourceBase
    if (base?.kind === 'directory') return base.path
    if (base?.kind === 'url') return base.url
    if (base?.kind === 'opaque') return base.description
    return skill.provider
  }

  const persistDisabledSkills = (): void => {
    writeDisabledSkills(dshCodeHome, disabledSkills)
    disabledSkillControl?.invalidate()
  }

  const runSkillsPicker = async (searchTerm: string): Promise<void> => {
    try {
      const skills = await ctx.skills.list({ cwd: process.cwd(), scope: agent })
      if (skills.length === 0) {
        host.showNotice('no skills discovered in project, dsh-code, DSH, Codex, or Claude roots')
        return
      }
      const skillByName = new Map(skills.map(skill => [skill.name, skill]))
      const userInvocableByName = new Map(skills.map((skill) => {
        const disabled = disabledSkills.get(skill.name)
        return [skill.name, disabled === undefined ? skill.invocation.userInvocable : disabled.userInvocable !== false]
      }))
      const items = skills.map((skill) => {
        const record = disabledSkills.get(skill.name)
        const disabled = record !== undefined
        const userInvocable = disabled ? record.userInvocable !== false : skill.invocation.userInvocable
        return {
          value: skill.name,
          label: skill.name,
          current: !disabled,
          description: disabled
            ? `${skill.description} · disabled for dsh-code · ${skillLocation(skill)}`
            : `${skill.description} · ${skill.source} · ${skillLocation(skill)}${userInvocable ? '' : ' · model-only'}`,
        }
      })
      host.showSelector({
        hint: '↑↓ select · Space enable/disable for dsh-code · Enter use · Esc close',
        initialQuery: searchTerm,
        borderColor: theme.selectorBorder,
        items,
        onSelect: (skillName) => {
          const skill = skillByName.get(skillName)
          if (skill === undefined) return
          const disabled = disabledSkills.get(skillName)
          if (disabled !== undefined) { host.showNotice(`skill ${skillName} is disabled; press Space in /skills to enable it`); return }
          if (userInvocableByName.get(skillName) !== true) { host.showNotice(`skill ${skillName} is model-invocable only`); return }
          host.setText(`/${skillName} `)
        },
        onToggle: (skillName) => {
          const skill = skillByName.get(skillName)
          const item = items.find(candidate => candidate.value === skillName)
          if (skill === undefined || item === undefined) return
          const disabled = disabledSkills.get(skillName)
          if (disabled !== undefined) {
            disabledSkills.delete(skillName)
            userInvocableByName.set(skillName, disabled.userInvocable !== false)
            item.current = true
            item.description = `${disabled.description} · ${disabled.source} · ${disabled.location}${disabled.userInvocable === false ? ' · model-only' : ''}`
          } else {
            const entry: DisabledSkillRecord = {
              name: skill.name,
              description: skill.description,
              source: skill.source,
              location: skillLocation(skill),
              userInvocable: skill.invocation.userInvocable,
              modelInvocable: skill.invocation.modelInvocable,
            }
            disabledSkills.set(skill.name, entry)
            userInvocableByName.set(skillName, false)
            item.current = false
            item.description = `${skill.description} · disabled for dsh-code · ${skillLocation(skill)}`
          }
          persistDisabledSkills()
        },
        onCancel: () => {},
      })
    } catch (error) {
      showCommandError('skill discovery', error)
    }
  }

  ctx.commands.register({
    name: 'skills',
    description: 'Discover and invoke project and user skills',
    input: { hint: '[search]' },
    handler: ({ rawInput }) => {
      void runSkillsPicker(rawInput.trim())
      return { kind: 'success' }
    },
  })

  const subagentDescription = (entry: SubagentDescendantListEntry): string => {
    if (entry.kind === 'diagnostic') return `${entry.id} · ${entry.reason}`
    const live = ctx.agents.get(entry.id)
    const activity = live?.status ?? entry.activity
    const label = entry.label === undefined ? '' : ` · ${entry.label}`
    return `${entry.id} · ${entry.mode} · ${activity}${label}`
  }

  const subagentItem = (entry: SubagentDescendantListEntry): SelectorItem => ({
    value: String(entry.id),
    label: `${'  '.repeat(Math.max(0, entry.depth - 1))}● ${entry.kind === 'child' ? entry.label ?? entry.id : entry.id}`,
    description: subagentDescription(entry),
  })

  let activeSubagentEntries: SubagentDescendantListEntry[] = []
  let agentsSelector: SelectorHandle | undefined
  let agentsSelectorOpen = false
  let subagentActionId: string | undefined
  let subagentRefreshRevision = 0
  let subagentDescriptorRetryTimer: ReturnType<typeof setTimeout> | undefined
  let subagentDescriptorRetryAttempt = 0

  const activeSubagentIds = (): string[] => [...new Set(
    [...activeSubagentRuns.values()].filter(id => !dismissedSubagents.has(id)),
  )]

  const syncActiveSubagentCount = (): number => {
    const count = activeSubagentCount(activeSubagentRuns, dismissedSubagents)
    host.setSubagentCount(count)
    if (count === 0) {
      if (subagentDescriptorRetryTimer !== undefined) clearTimeout(subagentDescriptorRetryTimer)
      subagentDescriptorRetryTimer = undefined
      subagentDescriptorRetryAttempt = 0
    }
    return count
  }

  const visibleSubagentItems = (): SelectorItem[] => {
    const entriesById = new Map(activeSubagentEntries.map(entry => [String(entry.id), entry]))
    return activeSubagentIds().map((id) => {
      const entry = entriesById.get(id)
      return entry === undefined
        ? { value: id, label: `● ${id}`, description: `${id} · starting · details loading` }
        : subagentItem(entry)
    })
  }

  const scheduleSubagentDescriptorRetry = (): void => {
    if (subagentDescriptorRetryTimer !== undefined || subagentDescriptorRetryAttempt >= 5) return
    const delay = Math.min(400, 50 * 2 ** subagentDescriptorRetryAttempt++)
    subagentDescriptorRetryTimer = setTimeout(() => {
      subagentDescriptorRetryTimer = undefined
      void refreshActiveSubagents().catch(error => { showCommandError('subagent refresh', error) })
    }, delay)
  }

  const refreshActiveSubagents = async (): Promise<SubagentDescendantListEntry[]> => {
    const revision = ++subagentRefreshRevision
    const all = await ctx.subagents.listDescendants(agent.session.id)
    if (revision !== subagentRefreshRevision) return activeSubagentEntries
    const activeIds = new Set(activeSubagentRuns.values())
    activeSubagentEntries = [...subagentEntriesForList(all, activeIds, dismissedSubagents)]
    const activeCount = syncActiveSubagentCount()
    if (activeSubagentEntries.length < activeCount) scheduleSubagentDescriptorRetry()
    else {
      if (subagentDescriptorRetryTimer !== undefined) clearTimeout(subagentDescriptorRetryTimer)
      subagentDescriptorRetryTimer = undefined
      subagentDescriptorRetryAttempt = 0
    }
    if (subagentActionId !== undefined
      && !activeSubagentEntries.some(entry => String(entry.id) === subagentActionId)) {
      subagentActionId = undefined
      host.clearInlineControl()
    }
    if (agentsSelectorOpen) {
      if (activeCount === 0) {
        agentsSelectorOpen = false
        agentsSelector = undefined
        host.clearInlineControl()
      } else {
        agentsSelector?.updateItems(visibleSubagentItems())
      }
    }
    return activeSubagentEntries
  }

  const cancelSubagent = (entry: SubagentDescendantListEntry): boolean => {
    if (entry.kind !== 'child') return false
    const live = ctx.agents.get(entry.id)
    if (entry.mode === 'continuable') {
      ctx.subagents.interrupt(entry.id, { kind: 'ancestor', agent })
      return true
    }
    if (live === undefined) return false
    live.cancel({ kind: 'user' })
    return true
  }

  const showSubagentActions = (entry: SubagentDescendantListEntry): void => {
    if (entry.kind !== 'child') return
    agentsSelectorOpen = false
    agentsSelector = undefined
    subagentActionId = String(entry.id)
    host.showSelector({
      hint: subagentDescription(entry),
      borderColor: theme.selectorBorder,
      items: [
        { value: 'cancel', label: 'Cancel task', description: 'Request cancellation and keep it visible until DSH settles the run' },
        { value: 'delete', label: 'Delete task', description: 'Request cancellation and remove it from the active task list now' },
        { value: 'back', label: 'Back to active agents' },
      ],
      onSelect: (action) => {
        subagentActionId = undefined
        if (action === 'back') { void runAgentsPicker(); return }
        try {
          if (!cancelSubagent(entry)) {
            host.showNotice(`cannot cancel ${entry.id}: no live local one-shot agent`)
            return
          }
          if (action === 'delete') {
            dismissedSubagents.add(String(entry.id))
            syncActiveSubagentCount()
          }
          host.showNotice(`${action === 'delete' ? 'removed' : 'cancellation requested for'} subagent ${entry.id}`)
          void refreshActiveSubagents().catch(error => { showCommandError('subagent refresh', error) })
        } catch (error) {
          showCommandError('subagent cancellation', error)
        }
      },
      onCancel: () => { subagentActionId = undefined; void runAgentsPicker() },
    })
  }

  const runAgentsPicker = async (): Promise<void> => {
    try {
      await refreshActiveSubagents()
      if (activeSubagentCount(activeSubagentRuns, dismissedSubagents) === 0) {
        host.showNotice('no subagents for this session')
        return
      }
      agentsSelectorOpen = true
      subagentActionId = undefined
      agentsSelector = host.showSelector({
        hint: 'Active subagents · Enter actions · Esc close · list updates live',
        borderColor: theme.selectorBorder,
        items: visibleSubagentItems(),
        onSelect: (id) => {
          const entry = activeSubagentEntries.find(candidate => String(candidate.id) === id)
          if (entry !== undefined) showSubagentActions(entry)
        },
        onCancel: () => { agentsSelectorOpen = false; agentsSelector = undefined },
      })
    } catch (error) {
      showCommandError('subagent listing', error)
    }
  }

  ctx.commands.register({
    name: 'agents',
    description: 'Inspect this session’s subagent tree',
    handler: () => {
      void runAgentsPicker()
      return { kind: 'success' }
    },
  })
  openAgentsPanel = () => { void runAgentsPicker() }

  // Slash-command autocomplete, refreshed whenever the command registry changes.
  // `fd` (when installed) enables pi-tui's fast fuzzy file search; dsh-code has
  // an in-process fallback for `@` references. `/permission` completes its
  // preset names from the permission-presets service.
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

  let autocompleteRevision = 0
  const syncCommands = (): void => {
    const revision = ++autocompleteRevision
    const fdPath = findFd()
    const presets = ctx.permissionPresets.names
    const modes = AGENT_MODE_OPTIONS.map(option => option.mode)
    const commands = ctx.commands.list(agent).map(command => ({
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
      ...(command.name === 'mode'
        ? {
          getArgumentCompletions: (prefix: string) => modes
            .filter(mode => mode.startsWith(prefix))
            .map(mode => ({ value: mode, label: mode })),
        }
        : {}),
    }))
    host.setAutocomplete(commands, process.cwd(), fdPath)
    void ctx.skills.list({ cwd: process.cwd(), scope: agent }).then((skills) => {
      if (revision !== autocompleteRevision) return
      const commandNames = new Set(commands.map(command => command.name))
      const skillEntries = skills
        .filter(skill => skill.invocation.userInvocable && !commandNames.has(skill.name))
        .map(skill => ({ name: skill.name, description: `${skill.description} [skill: ${skill.source}]` }))
      host.setAutocomplete([...commands, ...skillEntries], process.cwd(), fdPath)
    }).catch(() => {
      // A discovery error is reported when /skills is opened; command
      // autocomplete remains usable with the synchronous registry entries.
    })
  }
  syncCommands()
  const disposeCommandsChange = ctx.on('commands/change', () => { syncCommands() })
  const disposeSkillsChange = ctx.on('skills/change', () => { syncCommands() })

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
    firstRun?: boolean
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
    const providers = { ...current?.providers }
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

  const showProviderSelector = (firstRun = false): void => {
    host.showSelector({
      hint: firstRun
        ? 'Welcome to dsh-code · Select a provider to configure your first API token.'
        : 'Select a model provider to configure.',
      borderColor: theme.selectorBorder,
      items: [
        { value: 'deepseek', label: 'DeepSeek', description: 'DeepSeek official API' },
        { value: 'openai', label: 'OpenAI', description: 'OpenAI official API' },
        { value: 'compatible', label: 'OpenAI-compatible', description: 'Custom OpenAI-compatible endpoint' },
      ],
      onSelect: (provider) => {
        const draft: ConfigDraft = { provider: provider as ConfigProvider, firstRun }
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
      onCancel: () => { showProviderSelector(draft.firstRun === true) },
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
        else showProviderSelector(draft.firstRun === true)
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

  // MCP configuration is owned by dsh-code. External products are scanned
  // only from the explicit Import flow; copied rows never remain linked to
  // their source. Live connections are ordinary public upstream MCP plugin
  // fibers owned by McpRuntimeManager, so no DSH internals are involved.
  interface McpDraft {
    transport?: McpServerConfig['transport']
    serverName?: string
    command?: string
    argsText?: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    url?: string
    headers?: Record<string, string>
    scope?: McpConfigScope
    origin?: ImportedMcpOrigin
  }

  const storedMcpServer = (draft: McpDraft): StoredMcpServer | undefined => {
    if (draft.serverName === undefined || draft.transport === undefined) return undefined
    if (draft.transport === 'stdio' && draft.command !== undefined) {
      return {
        serverName: draft.serverName,
        transport: 'stdio',
        command: draft.command,
        args: draft.args ?? [],
        env: draft.env ?? {},
        ...(draft.cwd === undefined ? {} : { cwd: draft.cwd }),
        enabled: true,
        ...(draft.origin === undefined ? {} : { origin: draft.origin }),
      }
    }
    if (draft.transport === 'streamable-http' && draft.url !== undefined) {
      return {
        serverName: draft.serverName,
        transport: 'streamable-http',
        url: draft.url,
        headers: draft.headers ?? {},
        enabled: true,
        ...(draft.origin === undefined ? {} : { origin: draft.origin }),
      }
    }
    return undefined
  }

  const finishMcpAdd = async (draft: McpDraft): Promise<void> => {
    const server = storedMcpServer(draft)
    if (server === undefined || draft.scope === undefined) return
    upsertMcpServer(dshCodeHome, process.cwd(), draft.scope, server)
    const reload = mcpRuntime.reload()
    showMcpManager()
    await reload
    const current = mcpRuntime.snapshot().find(entry => entry.scope === draft.scope && entry.serverName === server.serverName)
    const status = current?.state === 'connected' ? 'connected' : current?.state ?? 'saved'
    host.showNotice(`saved ${draft.scope} MCP server ${server.serverName} · ${status}`)
  }

  const showMcpScopeSelector = (draft: McpDraft, onBack: () => void, onChosen?: () => void): void => {
    host.showSelector({
      hint: 'Choose where dsh-code independently stores this MCP server.',
      borderColor: theme.selectorBorder,
      items: [
        { value: 'user', label: 'User', description: '~/.dsh-code/mcp.json · available in every dsh-code project' },
        { value: 'project', label: 'Project', description: '.dsh-code/mcp.json · only the current trusted project' },
      ],
      onSelect: (scope) => {
        draft.scope = scope as McpConfigScope
        if (onChosen !== undefined) onChosen()
        else void finishMcpAdd(draft).catch(error => { showCommandError('MCP save', error) })
      },
      onCancel: onBack,
    })
  }

  const showMcpArgsInput = (draft: McpDraft): void => {
    host.showInlineInput({
      prompt: 'Arguments as a JSON string array:',
      hint: 'Example: ["-y","some-mcp-server"] · use [] for none · Esc back',
      initialValue: draft.argsText ?? '[]',
      borderColor: theme.selectorBorder,
      onSubmit: (value) => {
        try {
          draft.args = parseMcpArguments(value)
          draft.argsText = JSON.stringify(draft.args)
          showMcpScopeSelector(draft, () => { showMcpArgsInput(draft) })
        } catch (error) {
          showCommandError('MCP arguments', error)
          draft.argsText = value
          showMcpArgsInput(draft)
        }
      },
      onCancel: () => { showMcpCommandInput(draft) },
    })
  }

  const showMcpCommandInput = (draft: McpDraft): void => {
    host.showInlineInput({
      prompt: 'Executable command (e.g. npx):',
      initialValue: draft.command,
      borderColor: theme.selectorBorder,
      onSubmit: (command) => { draft.command = command; showMcpArgsInput(draft) },
      onCancel: () => { showMcpNameInput(draft) },
    })
  }

  const showMcpUrlInput = (draft: McpDraft): void => {
    host.showInlineInput({
      prompt: 'Streamable HTTP URL:',
      initialValue: draft.url,
      borderColor: theme.selectorBorder,
      onSubmit: (url) => {
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('URL must use http or https')
          draft.url = parsed.toString()
          showMcpScopeSelector(draft, () => { showMcpUrlInput(draft) })
        } catch (error) {
          showCommandError('MCP URL', error)
          draft.url = url
          showMcpUrlInput(draft)
        }
      },
      onCancel: () => { showMcpNameInput(draft) },
    })
  }

  const showMcpNameInput = (draft: McpDraft): void => {
    host.showInlineInput({
      prompt: 'Server name (namespace for mcp__<name>__ tools):',
      hint: '1–32 letters, numbers, underscores, or hyphens · Enter continue · Esc back',
      initialValue: draft.serverName,
      borderColor: theme.selectorBorder,
      onSubmit: (serverName) => {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
          host.showNotice('invalid MCP server name; use 1–32 letters, numbers, underscores, or hyphens')
          draft.serverName = serverName
          showMcpNameInput(draft)
          return
        }
        draft.serverName = serverName
        if (draft.transport === 'stdio') showMcpCommandInput(draft)
        else showMcpUrlInput(draft)
      },
      onCancel: () => { showMcpTransportSelector(draft) },
    })
  }

  const showMcpTransportSelector = (draft: McpDraft = {}): void => {
    host.showSelector({
      hint: 'Select the MCP transport.',
      borderColor: theme.selectorBorder,
      items: [
        { value: 'stdio', label: 'stdio', description: 'Local executable managed by the bundled dsh MCP client' },
        { value: 'streamable-http', label: 'Streamable HTTP', description: 'Remote MCP endpoint managed by the bundled dsh MCP client' },
      ],
      onSelect: (transport) => {
        draft.transport = transport as McpServerConfig['transport']
        showMcpNameInput(draft)
      },
      onCancel: () => { showMcpManager() },
    })
  }

  const externalMcpDescription = (server: DiscoveredMcpServer): string => {
    const endpoint = server.transport === 'stdio' ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`.trim() : server.url ?? ''
    const credentialCount = server.transport === 'stdio'
      ? Object.keys(server.env ?? {}).length
      : Object.keys(server.headers ?? {}).length
    return `${externalMcpLocation(server)} · ${endpoint}${server.sourceEnabled ? '' : ' · disabled at source'}${credentialCount === 0 ? '' : ` · ${credentialCount} private value(s)`}`
  }

  const showMcpManagerLater = (): void => { showMcpManager() }

  const confirmExternalMcpImport = (server: DiscoveredMcpServer, draft: McpDraft): void => {
    const privateValues = server.transport === 'stdio'
      ? Object.keys(server.env ?? {}).length
      : Object.keys(server.headers ?? {}).length
    const warnings = [
      ...server.warnings,
      ...(privateValues > 0 ? ['private environment/header values will be copied into a mode-0600 dsh-code config'] : []),
      ...(!server.sourceEnabled ? ['the source entry is disabled; the imported dsh-code copy will be enabled independently'] : []),
    ]
    host.showSelector({
      hint: `Import ${server.product}/${server.serverName} as ${draft.serverName ?? server.serverName} into dsh-code ${draft.scope ?? 'project'} scope.`,
      borderColor: theme.selectorBorder,
      items: [
        {
          value: 'import',
          label: 'Import and connect',
          description: warnings.length === 0
            ? 'Create an independent dsh-code copy; the source stays unchanged'
            : `Create an independent copy · ${warnings[0]}`,
        },
        { value: 'cancel', label: 'Cancel' },
      ],
      onSelect: (choice) => {
        if (choice !== 'import') { showMcpManagerLater(); return }
        void finishMcpAdd(draft).catch(error => { showCommandError('MCP import', error) })
      },
      onCancel: showMcpManagerLater,
    })
  }

  const showExternalMcpNameInput = (server: DiscoveredMcpServer): void => {
    host.showInlineInput({
      prompt: `dsh-code server name for ${server.product}/${server.serverName}:`,
      hint: '1–32 letters, numbers, underscores, or hyphens · Esc back',
      initialValue: server.serverName,
      borderColor: theme.selectorBorder,
      onSubmit: (serverName) => {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
          host.showNotice('invalid MCP server name; use 1–32 letters, numbers, underscores, or hyphens')
          showExternalMcpNameInput({ ...server, serverName })
          return
        }
        const draft: McpDraft = {
          transport: server.transport,
          serverName,
          ...(server.command === undefined ? {} : { command: server.command }),
          ...(server.args === undefined ? {} : { args: server.args }),
          ...(server.env === undefined ? {} : { env: server.env }),
          ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
          ...(server.url === undefined ? {} : { url: server.url }),
          ...(server.headers === undefined ? {} : { headers: server.headers }),
          origin: { product: server.product, serverName: server.serverName, sourcePath: server.sourcePath },
        }
        showMcpScopeSelector(
          draft,
          () => { showExternalMcpNameInput(server) },
          () => { confirmExternalMcpImport(server, draft) },
        )
      },
      onCancel: () => { showExternalMcpImporter() },
    })
  }

  const showExternalMcpImporter = (): void => {
    const externalServers = discoverExternalMcpServers({ cwd: process.cwd() })
    if (externalServers.length === 0) {
      host.showNotice('no MCP servers found in Claude Code, OpenAI Codex, or standalone DSH configurations')
      showMcpManager()
      return
    }
    const items: SelectorItem[] = []
    const groups = new Map<string, DiscoveredMcpServer[]>()
    for (const server of externalServers) {
      const key = `${server.product}\u0000${server.sourcePath}`
      const group = groups.get(key)
      if (group === undefined) groups.set(key, [server])
      else group.push(server)
    }
    const productOrder = { claude: 0, codex: 1, dsh: 2 } as const
    const sorted = [...groups.entries()].sort(([, left], [, right]) => {
      const a = left[0]
      const b = right[0]
      if (a === undefined || b === undefined) return 0
      return productOrder[a.product] - productOrder[b.product] || a.sourcePath.localeCompare(b.sourcePath)
    })
    for (const [section, servers] of sorted) {
      const first = servers[0]
      if (first === undefined) continue
      items.push({ value: `heading:${section}`, label: externalMcpSourceLabel(first), selectable: false, section })
      for (const server of servers) {
        items.push({
          value: `external:${server.id}`,
          label: `  ${server.serverName}${server.sourceEnabled ? '' : theme.dim(' · disabled at source')}`,
          description: externalMcpDescription(server),
          section,
        })
      }
    }
    host.showSelector({
      hint: 'External configs are scanned only here · Enter import a private independent copy · Esc back',
      borderColor: theme.selectorBorder,
      items,
      onSelect: (value) => {
        const server = externalServers.find(candidate => `external:${candidate.id}` === value)
        if (server !== undefined) showExternalMcpNameInput(server)
      },
      onCancel: showMcpManagerLater,
    })
  }

  const confirmMcpRemoval = (server: McpRuntimeSnapshot): void => {
    host.showSelector({
      hint: `Remove ${server.scope} MCP server ${server.serverName} from dsh-code?`,
      borderColor: theme.selectorBorder,
      items: [
        { value: 'remove', label: 'Remove server' },
        { value: 'cancel', label: 'Keep server' },
      ],
      onSelect: (choice) => {
        if (choice === 'remove') {
          removeMcpServer(dshCodeHome, process.cwd(), server.scope, server.serverName)
          const reload = mcpRuntime.reload()
          showMcpManager()
          void reload.then(() => {
            host.showNotice(`removed ${server.scope} MCP server ${server.serverName} · disconnected`)
          }).catch(error => { showCommandError('MCP removal', error) })
        } else {
          showMcpManager()
        }
      },
      onCancel: () => { showMcpManager() },
    })
  }

  const showMcpRemovalPicker = (): void => {
    const servers = mcpRuntime.snapshot()
    if (servers.length === 0) { host.showNotice('no dsh-code MCP servers configured'); return }
    host.showSelector({
      hint: 'Select a dsh-code MCP server to remove.',
      borderColor: theme.selectorBorder,
      items: servers.map(server => ({
        value: `${server.scope}:${server.serverName}`,
        label: `${server.serverName} · ${server.scope}`,
        description: server.config.transport === 'stdio'
          ? `stdio · ${server.config.command ?? ''} ${(server.config.args ?? []).join(' ')}`.trim()
          : `Streamable HTTP · ${server.config.url ?? ''}`,
      })),
      onSelect: (value) => {
        const server = servers.find(candidate => `${candidate.scope}:${candidate.serverName}` === value)
        if (server !== undefined) confirmMcpRemoval(server)
      },
      onCancel: () => { showMcpManager() },
    })
  }

  const mcpStateLabel = (server: McpRuntimeSnapshot): string => {
    if (server.state === 'connected') return theme.success(`● connected${server.toolCount > 0 ? ` · ${server.toolCount} tools` : ''}`)
    if (server.state === 'connecting') return theme.warning('◐ connecting')
    if (server.state === 'error') return theme.error('× error')
    if (server.state === 'disabled') return theme.dim('○ disabled')
    if (server.state === 'overridden') return theme.dim('○ overridden by project')
    return theme.dim('○ not connected')
  }

  const mcpManagerItems = (snapshot: readonly McpRuntimeSnapshot[]): SelectorItem[] => {
    const items: SelectorItem[] = []
    for (const scope of ['user', 'project'] as const) {
      const servers = snapshot.filter(server => server.scope === scope)
      if (servers.length === 0) continue
      const section = `dsh-code-${scope}`
      items.push({
        value: `heading:${section}`,
        label: scope === 'user' ? 'dsh-code User (~/.dsh-code/mcp.json):' : 'dsh-code Project (.dsh-code/mcp.json):',
        selectable: false,
        section,
      })
      for (const server of servers) {
        const origin = server.config.origin === undefined ? '' : ` · imported from ${server.config.origin.product}`
        const endpoint = server.config.transport === 'stdio'
          ? `${server.config.command ?? ''} ${(server.config.args ?? []).join(' ')}`.trim()
          : server.config.url ?? ''
        items.push({
          value: `managed:${server.scope}:${server.serverName}`,
          label: `  ${server.serverName} ${mcpStateLabel(server)}`,
          description: `${server.config.transport} · ${endpoint}${origin}${server.error === undefined ? '' : ` · ${server.error}`}`,
          section,
          current: server.config.enabled && server.state !== 'overridden',
        })
      }
    }
    const section = 'actions'
    items.push(
      { value: `heading:${section}`, label: 'Actions:', selectable: false, section },
      { value: 'action:import', label: '  Import from other agents…', description: 'Scan Claude Code, OpenAI Codex, and standalone DSH only when selected', section },
      { value: 'action:add', label: '  Add MCP server…', section },
    )
    return items
  }

  let stopMcpStatusUpdates: (() => void) | undefined
  const stopMcpStatus = (): void => {
    stopMcpStatusUpdates?.()
    stopMcpStatusUpdates = undefined
  }

  const showMcpManager = (): void => {
    stopMcpStatus()
    const handle = host.showSelector({
      hint: '↑↓ select · Space enable/disable · Enter remove/action · status updates live · Esc close',
      borderColor: theme.selectorBorder,
      items: mcpManagerItems(mcpRuntime.snapshot()),
      onSelect: (value) => {
        stopMcpStatus()
        if (value === 'action:import') { showExternalMcpImporter(); return }
        if (value === 'action:add') { showMcpTransportSelector(); return }
        if (value.startsWith('managed:')) {
          const server = mcpRuntime.snapshot().find(candidate => `managed:${candidate.scope}:${candidate.serverName}` === value)
          if (server !== undefined) confirmMcpRemoval(server)
        }
      },
      onToggle: (value) => {
        if (!value.startsWith('managed:')) return
        const server = mcpRuntime.snapshot().find(candidate => `managed:${candidate.scope}:${candidate.serverName}` === value)
        if (server === undefined || server.state === 'overridden') return
        setMcpServerEnabled(dshCodeHome, process.cwd(), server.scope, server.serverName, !server.config.enabled)
        void mcpRuntime.reload().catch(error => { showCommandError('MCP toggle', error) })
      },
      onCancel: () => { stopMcpStatus() },
    })
    stopMcpStatusUpdates = mcpRuntime.subscribe(snapshot => { handle.updateItems(mcpManagerItems(snapshot)) })
  }

  ctx.commands.register({
    name: 'mcp',
    description: 'Manage dsh-code MCP servers and import external agent configs',
    input: { hint: '[add|import|remove [serverName]]' },
    handler: ({ rawInput }) => {
      const input = rawInput.trim()
      if (input === '') {
        showMcpManager()
        return { kind: 'success' }
      }
      const [sub, name] = input.split(/\s+/)
      if (sub === 'add') {
        showMcpTransportSelector()
        return { kind: 'success' }
      }
      if (sub === 'discover' || sub === 'import') {
        showExternalMcpImporter()
        return { kind: 'success' }
      }
      if (sub === 'remove') {
        if (name === undefined) { showMcpRemovalPicker(); return { kind: 'success' } }
        const matches = mcpRuntime.snapshot().filter(candidate => candidate.serverName === name)
        const server = matches.find(candidate => candidate.scope === 'project') ?? matches[0]
        if (server === undefined) return { kind: 'error', text: `unknown dsh-code MCP server "${name}"` }
        confirmMcpRemoval(server)
        return { kind: 'success' }
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
      const sessionTitle = ctx.sessionTitle.get(agent.session)?.title
      const activeModel = modelRef.current ?? selection
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
        ...(sessionTitle === undefined ? [] : [`title: ${sessionTitle}`]),
        `cwd: ${header.cwd ?? ''}`,
        `created: ${new Date(header.createdAt).toLocaleString()}`,
        ...(header.parentSession !== undefined ? [`parent: ${String(header.parentSession)}`] : []),
        `model: ${activeModel.provider}/${activeModel.model}`,
        `mode: ${agentModeForPreset(activePreset) === 'ptc' ? 'PTC' : 'Standard'}`,
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

  const renameSession = (title: string): void => {
    try {
      const renamed = ctx.sessionTitle.rename(agent.session, title)
      host.showNotice(`session renamed: ${renamed.title}`)
    } catch (error) {
      showCommandError('session rename', error)
    }
  }

  const showRenameInput = (): void => {
    host.showInlineInput({
      prompt: 'Session title:',
      initialValue: ctx.sessionTitle.get(agent.session)?.title,
      borderColor: theme.selectorBorder,
      onSubmit: renameSession,
      onCancel: () => {},
    })
  }

  ctx.commands.register({
    name: 'rename',
    description: 'Rename and pin the current session title',
    input: { hint: '[title]' },
    handler: ({ rawInput }) => {
      const title = rawInput.trim()
      if (title === '') showRenameInput()
      else renameSession(title)
      return { kind: 'success' }
    },
  })

  const jobSummary = (job: JobSnapshot): string => {
    const finished = job.finishedAt ?? Date.now()
    const seconds = Math.max(0, Math.floor((finished - job.startedAt) / 1000))
    return `${job.kind} · ${job.status} · ${seconds}s${job.detail === undefined ? '' : ` · ${job.detail}`}`
  }

  const confirmJobKill = (job: JobSnapshot): void => {
    host.showSelector({
      hint: `Stop ${job.id} · ${job.label}?`,
      borderColor: theme.selectorBorder,
      items: [
        { value: 'kill', label: 'Stop job' },
        { value: 'cancel', label: 'Keep running' },
      ],
      onSelect: (choice) => {
        if (choice === 'kill') {
          try {
            const outcome = ctx.jobs.kill(job.id, agent, 'stopped from dsh-code TUI')
            host.showNotice(`${job.id}: ${outcome}`)
          } catch (error) {
            showCommandError('job stop', error)
          }
        } else {
          showJobsPicker()
        }
      },
      onCancel: () => { showJobsPicker() },
    })
  }

  const showJobActions = (id: JobId): void => {
    let job: JobSnapshot
    try {
      job = ctx.jobs.get(id, agent)
    } catch (error) {
      showCommandError('job lookup', error)
      return
    }
    const live = job.status === 'running' || job.status === 'stopping'
    host.showSelector({
      hint: `${job.id} · ${jobSummary(job)} · ${job.label}`,
      borderColor: theme.selectorBorder,
      items: [
        { value: 'output', label: 'Read latest output' },
        ...(live ? [{ value: 'kill', label: 'Stop job' }] : []),
        { value: 'back', label: 'Back to jobs' },
      ],
      onSelect: (action) => {
        if (action === 'back') { showJobsPicker(); return }
        if (action === 'kill') { confirmJobKill(job); return }
        try {
          const read = ctx.jobs.read(job.id, agent)
          const output = read.text.trim()
          host.showNotice(`${job.id} · ${jobSummary(read.snapshot)}${output === '' ? ' · no new output' : `\n${output}`}`)
        } catch (error) {
          showCommandError('job output', error)
        }
      },
      onCancel: () => { showJobsPicker() },
    })
  }

  const showJobsPicker = (): void => {
    const jobs = ctx.jobs.list(agent)
    if (jobs.length === 0) { host.showNotice('no background jobs for this session'); return }
    host.showSelector({
      hint: 'Background jobs · select one for output or stop actions',
      borderColor: theme.selectorBorder,
      items: jobs.map(job => ({
        value: String(job.id),
        label: `${job.status === 'running' ? '●' : job.status === 'stopping' ? '◐' : '○'} ${job.id} · ${job.label}`,
        description: jobSummary(job),
      })),
      onSelect: (id) => { showJobActions(id as JobId) },
      onCancel: () => {},
    })
  }

  const disposeJobController = ctx.jobs.attachController('dsh-code-tui')

  ctx.commands.register({
    name: 'jobs',
    description: 'Inspect and control this session’s background jobs',
    handler: () => {
      showJobsPicker()
      return { kind: 'success' }
    },
  })

  const exportSession = async (path: string, explicitFormat?: SessionExportFormat): Promise<void> => {
    try {
      await ctx.sessions.flush(agent.session)
      const format = explicitFormat ?? exportFormatForPath(path)
      const title = ctx.sessionTitle.get(agent.session)?.title
      const absolute = writeSessionExport(process.cwd(), path, agent.session, format, title)
      host.showNotice(`session exported to ${absolute}`)
    } catch (error) {
      showCommandError('session export', error)
    }
  }

  const showExportPathInput = (format: SessionExportFormat): void => {
    host.showInlineInput({
      prompt: `Export ${format === 'markdown' ? 'Markdown' : 'JSONL'} path:`,
      hint: 'Session exports may contain project data · existing files are not overwritten · Esc back',
      initialValue: defaultExportFilename(String(agent.session.id), format),
      borderColor: theme.selectorBorder,
      onSubmit: (path) => { void exportSession(path, format) },
      onCancel: () => { showExportFormatSelector() },
    })
  }

  const showExportFormatSelector = (): void => {
    host.showSelector({
      hint: 'Export the current public DSH Session log.',
      borderColor: theme.selectorBorder,
      items: [
        { value: 'markdown', label: 'Markdown', description: 'Human-readable conversation and tool activity' },
        { value: 'jsonl', label: 'JSONL', description: 'Session header followed by exact public Session events' },
      ],
      onSelect: (format) => { showExportPathInput(format as SessionExportFormat) },
      onCancel: () => {},
    })
  }

  ctx.commands.register({
    name: 'export',
    description: 'Export the current session as Markdown or JSONL',
    input: { hint: '[path.md|path.jsonl]' },
    handler: ({ rawInput }) => {
      const path = rawInput.trim()
      if (path === '') showExportFormatSelector()
      else void exportSession(path)
      return { kind: 'success' }
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
        return { kind: 'success', text: `forked session ${child.id} · use /tree to switch` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  const switchBlocker = (): string | undefined => sessionSwitchBlocker({
    agentRunning: agent.status === 'running',
    queuedMessages: reducer.queuedMessages.length,
    liveJobs: ctx.jobs.list(agent).filter(job => job.status === 'running' || job.status === 'stopping').length,
    activeSubagents: activeSubagentCount(activeSubagentRuns, dismissedSubagents),
  })

  const switchToSession = async (targetId: string): Promise<void> => {
    const currentId = String(agent.session.id)
    if (targetId === currentId) {
      host.showNotice('already on the selected session')
      return
    }
    const blocked = switchBlocker()
    if (blocked !== undefined) {
      host.showNotice(`session switch blocked: ${blocked}`)
      return
    }
    try {
      const target = await ctx.sessionQuery.readSession(SessionId(targetId))
      if (target.session.cwd !== process.cwd() || target.session.origin === 'subagent') {
        throw new Error('the selected session is outside the current project conversation tree')
      }
      await sessions.flush(agent.session)
      await sendSessionSwitch(targetId)
      await shutdown(0)
    } catch (error) {
      showCommandError('session switch', error)
    }
  }

  let sessionTreeLoading = false
  const showSessionTree = async (): Promise<void> => {
    if (sessionTreeLoading) {
      host.showNotice('session tree is already loading')
      return
    }
    const blocked = switchBlocker()
    if (blocked !== undefined) {
      host.showNotice(`session switch blocked: ${blocked}`)
      return
    }
    sessionTreeLoading = true
    try {
      const records = await ctx.sessionQuery.filterSessions([{ kind: 'cwd', values: [process.cwd()] }])
      const eligible = records.filter(record => record.header.origin !== 'subagent')
      const titleResults: SessionTitleObservationResult[] = await ctx.sessionQuery.readTitleSnapshots(
        eligible.map(record => record.header.id),
      )
      const titles = new Map<string, string>()
      for (const result of titleResults) {
        if (result.status === 'fulfilled' && result.value.title !== undefined) {
          titles.set(String(result.sessionId), result.value.title.title)
        }
      }
      const rows = buildSessionTreeRows(eligible, String(agent.session.id), titles)
      if (rows.length === 0) {
        host.showNotice('no sessions in the current conversation tree')
        return
      }
      const lateBlocker = switchBlocker()
      if (lateBlocker !== undefined) {
        host.showNotice(`session switch blocked: ${lateBlocker}`)
        return
      }
      host.showSessionTree({
        rows,
        borderColor: theme.selectorBorder,
        onSelect: (sessionId) => {
          if (rows.find(row => row.id === sessionId)?.persisted !== true) {
            host.showNotice('session switch blocked: the selected session has not been persisted')
            return
          }
          void switchToSession(sessionId)
        },
        onCancel: () => {},
      })
    } catch (error) {
      showCommandError('session tree', error)
    } finally {
      sessionTreeLoading = false
    }
  }

  ctx.commands.register({
    name: 'tree',
    description: 'Browse this project’s session tree and switch branches',
    handler: () => {
      void showSessionTree()
      return { kind: 'success' }
    },
  })

  const scheduleRender = (measureContextTokens = false): void => {
    if (measureContextTokens) contextTokensDirty = true
    if (renderTimer !== undefined) return
    renderTimer = setTimeout(() => {
      renderTimer = undefined
      if (contextTokensDirty) {
        host.setContextTokens(ctx.tokenMeter.measure(agent.session).totalTokens)
        contextTokensDirty = false
      }
      host.render(reducer)
    }, STREAM_RENDER_INTERVAL_MS)
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
    // assistant/chunk changes only the ephemeral draft. TokenMeter's durable
    // surface changes on committed messages/tool events, so cloning it for
    // every streamed delta adds latency without changing the status value.
    scheduleRender(shouldMeasureContextTokens(event.type))
  })

  const disposeStatus = ctx.on('agent/status', (payload: { agent: Agent; status: 'idle' | 'running' }) => {
    if (payload.agent !== agent) return
    scheduleRender()
  })

  const disposeSubagentStart = agent.ctx.on('subagent/start', (info: SubagentRunInfo) => {
    activeSubagentRuns.set(String(info.runId), String(info.id))
    dismissedSubagents.delete(String(info.id))
    subagentDescriptorRetryAttempt = 0
    syncActiveSubagentCount()
    void refreshActiveSubagents().catch(error => { showCommandError('subagent refresh', error) })
  })

  const disposeSubagentEnd = agent.ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
    activeSubagentRuns.delete(String(info.runId))
    if (![...activeSubagentRuns.values()].includes(String(info.id))) dismissedSubagents.delete(String(info.id))
    syncActiveSubagentCount()
    void refreshActiveSubagents().catch(error => { showCommandError('subagent refresh', error) })
  })

  // Permission answerer: a one-shot Allow/Reject bar for this agent's tool
  // calls. Never infers a durable grant; Esc/abort settles as `cancelled`.
  const disposeApproval = ctx.on('approval/request', (request, next) => {
    if (request.agent !== agent) return next()
    return host.askApproval({
      toolName: request.toolName,
      ...(request.callId === undefined ? {} : { callId: String(request.callId) }),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    }, request.signal).then(value => value ?? 'cancelled')
  })

  // Structured user-question provider shared by ask_user_question and the
  // plan-mode review intent. The host returns one complete, protocol-shaped
  // answer batch; Esc and turn cancellation stay distinct failures.
  const disposeQuestions = ctx.userQuestions.registerProvider({
    async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      if (request.agent !== undefined && request.agent !== agent) {
        throw new UserQuestionError('dsh-code can only answer questions for its active root agent', 'CALLER_NOT_LIVE')
      }
      const answer = await host.askQuestions(request.questions, request.signal)
      if (answer !== undefined) return answer
      if (request.signal?.aborted === true) {
        throw new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED')
      }
      throw new UserQuestionError('the user cancelled ask_user_question', 'ASK_CANCELLED')
    },
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
    if (subagentDescriptorRetryTimer !== undefined) {
      clearTimeout(subagentDescriptorRetryTimer)
      subagentDescriptorRetryTimer = undefined
    }
    host.stop()
    disposeEvents()
    disposeStatus()
    disposeSubagentStart()
    disposeSubagentEnd()
    disposeApproval()
    disposeQuestions()
    disposeCommandsChange()
    disposeSkillsChange()
    disposeJobController()
    stopMcpStatus()
    try {
      await mcpRuntime.dispose()
    } catch {
      // Context disposal still owns any remaining child MCP fibers.
    }
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
        if (agent.status === 'running') return { kind: 'error', text: 'interrupt the active turn before exiting (Esc)' }
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
  void mcpRuntime.start().catch(error => { showCommandError('MCP startup', error) })
  if (process.env[FIRST_MODEL_CONFIG_ENV] === '1') showProviderSelector(true)
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
