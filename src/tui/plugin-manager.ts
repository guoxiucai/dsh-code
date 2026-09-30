/** Profile plugin management through the upstream service, with terminal-owned navigation. */
import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { stripVTControlCharacters } from 'node:util'
import { wrapTextWithAnsi } from '@earendil-works/pi-tui'
import type PluginManager from '@deepseek-ai/dsh-plugin-manager'
import type {
  BundleInfo, ChangeResult, InstallBundleOptions, PluginInfo,
  PluginInstallLogChunk, PluginInstallProgress, PluginInstallRequestId,
} from '@deepseek-ai/dsh-plugin-manager/types'
import type { TuiHost } from './host.ts'
import type { SelectorHandle, SelectorItem, SelectorOptions } from './selector.ts'
import { theme } from './theme.ts'
import { tuiBundleRestriction } from '../tui-bundle-policy.ts'

type Manager = Pick<PluginManager, 'listBundles' | 'listPlugins' | 'inspect' | 'installBundle'
  | 'setBundleEnabled' | 'setPluginEnabled' | 'removeBundle' | 'cancelInstall'>
type Host = Pick<TuiHost, 'showSelector' | 'showInlineInput' | 'showNotice'>

/** Dependencies that own runtime activity and the existing session handoff. */
export interface PluginPanelOptions {
  manager: Manager | undefined
  host: Host
  blocker: () => string | undefined
  reload: () => Promise<void>
  tools: () => readonly { name: string; description?: string }[]
  columns?: () => number
  subscribe: (log: (chunk: PluginInstallLogChunk) => void, progress: (state: PluginInstallProgress) => void) => () => void
}

interface Operation {
  title: string
  requestId?: PluginInstallRequestId
  phase: string
  started: number
  log: string
  cancelling: boolean
  panel?: SelectorHandle
  timer?: ReturnType<typeof setInterval>
  result?: Promise<ChangeResult>
}

const PRODUCT_ROWS = new Set([
  'dsh-code-tui', 'dsh-code-compatible-skills', 'dsh-code-tool-ask-user',
  'agent-presets', 'agent-preset-registry', 'subagent-model-selection-settings',
  'preset-standard', 'preset-ptc',
])

/** Package descriptions and subprocess logs must never issue terminal control sequences. */
function plain(value: string): string {
  return stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

function errorText(error: unknown): string { return plain(error instanceof Error ? error.message : String(error)) }
function action(value: string, label: string, description?: string): SelectorItem {
  return { value, label, ...(description === undefined ? {} : { description }) }
}

function protectedReason(row: PluginInfo): string | undefined {
  const id = row.patchId ?? String(row.entryId).split(':').at(-1) ?? ''
  return PRODUCT_ROWS.has(id) ? 'Required by dsh-code' : row.readOnlyReason
}

/** Manage one profile without duplicating its package, Loader or persistence state. */
export class PluginPanel {
  private revision = 0
  private disposed = false
  private watcher: ReturnType<typeof setTimeout> | undefined
  private inspection: AbortController | undefined
  private operation: Operation | undefined
  private readonly restarts = new Set<string>()
  private readonly outcomes = new Map<string, ChangeResult>()
  private readonly unsubscribe: () => void

  constructor(private readonly options: PluginPanelOptions) {
    this.unsubscribe = options.subscribe(chunk => {
      const operation = this.operation
      if (operation?.requestId === undefined || chunk.requestId !== operation.requestId) return
      operation.log = (operation.log + plain(chunk.text)).slice(-8192)
      this.renderProgress(operation)
    }, state => {
      const operation = this.operation
      if (operation?.requestId !== state.requestId) return
      operation.phase = state.phase === 'installing'
        ? `Installing dependencies${state.attempt === undefined ? '' : ` (registry attempt ${state.attempt.index}/${state.attempt.total})`}`
        : state.phase === 'cancelling' ? 'Cancelling; waiting for process exit and file restoration' : 'Applying configuration'
      this.renderProgress(operation)
    })
  }

  /** While a mutation is running, callers keep the Agent idle and preserve editor text. */
  get busy(): boolean { return this.operation !== undefined }

  private leave(): number {
    this.revision++
    clearTimeout(this.watcher)
    this.watcher = undefined
    this.inspection?.abort()
    this.inspection = undefined
    return this.revision
  }

  private current(revision: number): boolean { return !this.disposed && revision === this.revision }

  private page(summary: readonly string[], items: SelectorItem[], onSelect: (value: string) => void,
    onCancel: () => void, extra: Partial<SelectorOptions> = {}): SelectorHandle {
    this.leave()
    return this.options.host.showSelector({
      summary: summary.map(line => {
        const text = plain(line)
        return text.startsWith('✓') ? theme.success(text) : text.startsWith('!') ? theme.error(text)
          : text.startsWith('↻') ? theme.warning(text) : text
      }), items, searchable: false,
      hint: '↑↓ select · Enter continue · Esc back', borderColor: theme.selectorBorder,
      onSelect, onCancel: () => { this.leave(); onCancel() }, ...extra,
    })
  }

  private failure(error: unknown, back: () => void): void {
    this.page(['Plugins · Operation failed', errorText(error)], [action('back', 'Back')], back, back)
  }

  private idle(): boolean {
    const reason = this.busy ? 'another plugin operation is running' : this.options.blocker()
    if (reason === undefined) return true
    this.options.host.showNotice(`Plugin change blocked: ${reason}`)
    return false
  }

  /** Open the installed bundle list; built-ins are a separate, explicit view. */
  async show(query = '', builtins = false): Promise<void> {
    if (this.disposed) return
    if (this.operation !== undefined) { this.progressPage(this.operation); return }
    const manager = this.options.manager
    if (manager === undefined) {
      this.options.host.showNotice('Plugin management is unavailable in this profile')
      return
    }
    const back = (): void => { if (builtins) void this.show() }
    this.page(['Loading plugins…'], [action('back', builtins ? 'Back' : 'Close')],
      () => { this.leave(); back() }, back, { hint: builtins ? 'Esc back' : 'Esc close' })
    const revision = this.revision
    try {
      let bundles = await manager.listBundles()
      let rows = await manager.listPlugins()
      if (!this.current(revision)) return
      const items = (): SelectorItem[] => {
        const visible = bundles.filter(bundle => builtins ? !bundle.installed : bundle.installed)
        return [
          ...visible.map(bundle => {
            const runtime = this.runtime(bundle, rows)
            const color = runtime === 'Active' ? theme.success : runtime.startsWith('Load failed') ? theme.error
              : runtime === 'Restart required' || runtime === 'Pending' ? theme.warning : theme.dim
            return action(bundle.name,
              `${bundle.enabled ? '●' : '○'} ${plain(bundle.name)}  ${plain(bundle.version ?? '?')}  ${bundle.enabled ? 'On' : 'Off'} · ${color(runtime)}`,
              plain(bundle.description ?? bundle.error?.diagnostic ?? ''))
          }),
          ...(visible.length === 0 ? [{ value: 'empty', label: builtins ? 'No built-in bundles' : 'No plugins installed', selectable: false }] : []),
          action('action:install', '+ Install plugin…'),
          action('action:builtin', builtins ? 'Back to installed plugins…' : 'View built-in plugins…'),
          action('action:tools', 'View current Agent tools…'),
          ...(this.restarts.size === 0 ? [] : [action('action:reload', '↻ Reload session…')]),
        ]
      }
      const handle = this.page([
        `Plugins${builtins ? ' › Built-in' : ''} · Profile: dsh-code`,
        'Changes affect all sessions using this profile.',
        ...(this.restarts.size > 0 ? ['Saved changes require session reload.'] : []),
      ], items(), value => {
        if (value === 'action:install') this.installInput()
        else if (value === 'action:builtin') void this.show('', !builtins)
        else if (value === 'action:tools') this.tools(() => { void this.show(query, builtins) })
        else if (value === 'action:reload') this.reloadPage()
        else void this.details(value, builtins)
      }, back, {
        searchable: true, initialQuery: query,
        hint: `↑↓ select · Enter details · Space enable/disable · Esc ${builtins ? 'back' : 'close'}`,
        onToggle: value => {
          const bundle = bundles.find(candidate => candidate.name === value)
          if (bundle !== undefined) void this.toggleBundle(bundle, builtins)
        },
      })
      const listRevision = this.revision
      const refresh = async (): Promise<void> => {
        try {
          const next = await Promise.all([manager.listBundles(), manager.listPlugins()])
          if (!this.current(listRevision)) return
          ;[bundles, rows] = next
          handle.updateItems(items())
        } catch (error) {
          if (this.current(listRevision)) handle.updateSummary(['Plugins · Profile: dsh-code', `Refresh failed: ${errorText(error)}`])
        }
        if (this.current(listRevision)) this.watcher = setTimeout(() => { void refresh() }, 2000)
      }
      this.watcher = setTimeout(() => { void refresh() }, 2000)
    } catch (error) {
      if (this.current(revision)) this.failure(error, () => { void this.show(query, builtins) })
    }
  }

  private runtime(bundle: BundleInfo, rows: PluginInfo[]): string {
    if (tuiBundleRestriction(bundle.name) !== undefined) return 'Separate application; unavailable in TUI'
    if (bundle.error !== undefined) return `Load failed (${bundle.error.code})`
    if (this.restarts.has(bundle.name)) return 'Restart required'
    const phases = bundle.rows.map(row => rows.find(item => item.entryId === row.entryId)?.fiberPhase)
    if (phases.includes('failed')) return 'Load failed'
    if (!bundle.enabled) return phases.includes('active') ? 'Still active / overridden' : 'Not selected'
    if (phases.includes('pending') || phases.includes('loading')) return 'Pending'
    if (phases.length > 0 && phases.every(phase => phase === 'active')) return 'Active'
    return 'Selected; see components'
  }

  private async details(name: string, builtins = false): Promise<void> {
    const manager = this.options.manager
    if (manager === undefined) return
    const back = (): void => { void this.show('', builtins) }
    this.page(['Loading plugin details…', name], [action('back', 'Back')], back, back)
    const revision = this.revision
    try {
      const [bundles, rows] = await Promise.all([manager.listBundles(), manager.listPlugins()])
      if (!this.current(revision)) return
      const bundle = bundles.find(item => item.name === name)
      if (bundle === undefined) { await this.show('', builtins); return }
      const restriction = tuiBundleRestriction(bundle.name)
      this.page([
        `Plugins › ${bundle.name}`, `Version: ${bundle.version ?? '?'} · Profile: dsh-code`,
        bundle.description ?? '',
        `Enabled: ${bundle.enabled ? 'On' : 'Off'} · Runtime: ${this.runtime(bundle, rows)}`,
        ...(restriction === undefined ? [] : [restriction]),
        ...(bundle.readOnlyReason === undefined ? [] : [`Read-only: ${bundle.readOnlyReason}`]),
        ...(bundle.error === undefined ? [] : [`Error: ${bundle.error.code}`]),
      ], [
        action('components', 'View components…'), action('tools', 'View current Agent tools…'),
        ...(!bundle.readOnlyReason && (restriction === undefined || bundle.enabled)
          ? [action('toggle', bundle.enabled ? 'Disable plugin' : 'Enable plugin')] : []),
        ...(bundle.removable && restriction === undefined ? [action('update', 'Update version…')] : []),
        ...(bundle.removable ? [action('remove', 'Uninstall…')] : []),
        ...(this.outcomes.has(name) || bundle.error !== undefined ? [action('diagnostics', 'View diagnostics…')] : []),
        ...(this.restarts.has(name) ? [action('reload', '↻ Reload session…')] : []),
        action('back', 'Back'),
      ], value => {
        const again = (): void => { void this.details(name, builtins) }
        if (value === 'components') this.components(bundle, rows, again)
        else if (value === 'tools') this.tools(again)
        else if (value === 'toggle') void this.toggleBundle(bundle, builtins)
        else if (value === 'update') this.updateInput(bundle)
        else if (value === 'remove') this.confirmRemoval(bundle)
        else if (value === 'reload') this.reloadPage()
        else if (value === 'diagnostics') void this.diagnostics(this.outcomes.get(name) ?? bundle.error, again)
        else back()
      }, back)
    } catch (error) {
      if (this.current(revision)) this.failure(error, () => { void this.show('', builtins) })
    }
  }

  private components(bundle: BundleInfo, rows: PluginInfo[], back: () => void): void {
    const declared = bundle.rows.map(row => ({ declared: row, live: rows.find(item => item.entryId === row.entryId) }))
    this.page([`Plugins › ${bundle.name} › Components`, 'Preset child rows are managed by their preset; this view lists bundle rows.'], [
      ...declared.map(({ declared: row, live }) => action(row.rowId,
        `${plain(row.rowId)} · ${live?.fiberPhase ?? 'Not loaded'}`, plain(row.moduleName))),
      ...bundle.overrides.map(id => ({ value: `override:${id}`, label: `Overrides: ${plain(id)}`, selectable: false })),
      action('back', 'Back'),
    ], value => {
      const item = declared.find(item => item.declared.rowId === value)
      if (item === undefined) { back(); return }
      const row = item.live
      const reason = row === undefined ? 'Not addressable in the running profile'
        : !bundle.installed ? 'Built-in component' : protectedReason(row)
      const again = (): void => { void this.details(bundle.name, !bundle.installed) }
      this.page([item.declared.rowId, item.declared.moduleName,
        `Runtime: ${row?.fiberPhase ?? 'Not loaded'}`,
        ...(reason === undefined ? [] : [`Read-only: ${reason}`]),
      ], [action('back', 'Back'), ...(reason === undefined && row !== undefined
        ? [action('toggle', row.enabled ? 'Disable component' : 'Enable component')] : [])], selected => {
        if (selected === 'toggle' && row !== undefined && reason === undefined) {
          void this.mutate(`Change ${item.declared.rowId}`, () => this.options.manager!.setPluginEnabled(row.entryId, !row.enabled))
        } else again()
      }, again)
    }, back, { searchable: true })
  }

  private tools(back: () => void): void {
    const tools = this.options.tools()
    this.page(['Current Agent tools', 'Agent tool registry; bundle ownership is not inferred.', 'In PTC mode, use tools through run_code.'], [
      ...tools.map(tool => action(tool.name, plain(tool.name), plain(tool.description ?? ''))),
      action('back', 'Back'),
    ], value => {
      const tool = tools.find(tool => tool.name === value)
      if (tool === undefined) back()
      else this.textPage([tool.name, tool.description ?? 'No description'], () => { this.tools(back) })
    }, back, { searchable: true })
  }

  private installInput(initialValue?: string): void {
    this.leave()
    this.options.host.showInlineInput({
      prompt: 'Install plugin · Profile: dsh-code',
      hint: 'Package[@version], absolute directory, Git URL or tarball · Enter inspect · Esc back',
      ...(initialValue === undefined ? {} : { initialValue }), borderColor: theme.selectorBorder,
      onSubmit: spec => { void this.inspect(spec) }, onCancel: () => { this.leave(); void this.show() },
    })
  }

  private async inspect(spec: string): Promise<void> {
    const manager = this.options.manager
    if (manager === undefined) return
    const back = (): void => { this.installInput(spec) }
    this.page(['Inspecting package…', spec], [action('cancel', 'Cancel inspection')], back, back)
    const revision = this.revision
    const controller = new AbortController()
    this.inspection = controller
    try {
      const result = await manager.inspect(spec, undefined, controller.signal)
      if (!this.current(revision)) return
      if (result.status === 'refused') {
        this.page(['Cannot install plugin', result.problem, result.reason], [action('back', 'Back')], back, back)
        return
      }
      const restriction = result.name === undefined ? undefined : tuiBundleRestriction(result.name)
      if (restriction !== undefined) {
        this.page(['Application bundle cannot be used in TUI', restriction], [action('back', 'Back')], back, back)
        return
      }
      this.page(['Install plugin?', `${result.name ?? spec}${result.version === undefined ? '' : ` · ${result.version}`}`,
        `Source: ${result.host ?? result.registry ?? result.kind} · Target: dsh-code`, result.description ?? '',
        ...(result.bundle === null ? ['Bundle and compatibility will be checked during installation.'] : []),
        'Plugin code runs in the application process.',
      ], [action('enable', 'Install and enable'), action('disabled', 'Install without enabling'), action('back', 'Back')], value => {
        if (value === 'back') back()
        else void this.install(spec, { enabled: value === 'enable', registry: result.registry })
      }, back)
    } catch (error) {
      if (this.current(revision)) this.failure(error, back)
    }
  }

  private updateInput(bundle: BundleInfo): void {
    this.leave()
    const back = (): void => { void this.details(bundle.name) }
    this.options.host.showInlineInput({
      prompt: `Update ${plain(bundle.name)} · current ${plain(bundle.version ?? '?')}`,
      hint: 'Exact version (for example 1.2.3 or 1.2.3-rc.1) · Enter review · Esc back',
      borderColor: theme.selectorBorder,
      onCancel: back,
      onSubmit: version => {
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
          this.options.host.showNotice('Enter an exact package version')
          this.updateInput(bundle)
          return
        }
        const spec = `${bundle.name}@${version}`
        this.page(['Update plugin?', spec, `Keep enabled: ${bundle.enabled ? 'On' : 'Off'}`,
          'Compatibility is checked during installation. Reload is required after updating.'],
        [action('back', 'Cancel'), action('update', 'Update')], value => {
          if (value === 'update') void this.install(spec, { enabled: bundle.enabled })
          else back()
        }, back)
      },
    })
  }

  private async toggleBundle(bundle: BundleInfo, builtins: boolean): Promise<void> {
    const restriction = tuiBundleRestriction(bundle.name)
    if (!bundle.enabled && restriction !== undefined) {
      this.options.host.showNotice(restriction)
      await this.details(bundle.name, builtins)
      return
    }
    if (bundle.readOnlyReason !== undefined) {
      this.options.host.showNotice(`Read-only: ${bundle.readOnlyReason}`)
      await this.details(bundle.name, builtins)
      return
    }
    await this.mutate(`${bundle.enabled ? 'Disable' : 'Enable'} ${bundle.name}`,
      () => this.options.manager!.setBundleEnabled(bundle.name, !bundle.enabled))
  }

  private confirmRemoval(bundle: BundleInfo): void {
    const back = (): void => { void this.details(bundle.name) }
    this.page([`Uninstall ${bundle.name}?`, 'Removes this bundle from the dsh-code profile.',
      'Other sessions using this profile may be affected.'],
    [action('back', 'Cancel'), action('remove', 'Uninstall')], value => {
      if (value === 'remove') void this.mutate(`Uninstall ${bundle.name}`, () => this.options.manager!.removeBundle(bundle.name))
      else back()
    }, back)
  }

  private async install(spec: string, options: InstallBundleOptions): Promise<void> {
    const requestId = randomUUID() as PluginInstallRequestId
    const { approvedBuilds: _approved, ...retryOptions } = options
    await this.mutate(`Install ${spec}`, () => this.options.manager!.installBundle(spec, { ...options, requestId }),
      requestId, { spec, options: retryOptions })
  }

  private async mutate(title: string, run: () => Promise<ChangeResult>, requestId?: PluginInstallRequestId,
    retry?: { spec: string; options: InstallBundleOptions }): Promise<void> {
    if (!this.idle()) { if (!this.busy) void this.show(); return }
    const operation: Operation = { title, phase: 'Starting', started: Date.now(), log: '', cancelling: false,
      ...(requestId === undefined ? {} : { requestId }) }
    this.operation = operation
    this.progressPage(operation)
    operation.timer = setInterval(() => { this.renderProgress(operation) }, 1000)
    let result: ChangeResult | undefined
    let failure: unknown
    try { operation.result = run(); result = await operation.result }
    catch (error) { failure = error }
    finally { clearInterval(operation.timer); this.operation = undefined }
    if (this.disposed) return
    if (result === undefined) { this.failure(failure, () => { void this.show() }); return }
    this.outcomes.set(result.target, result)
    if (result.application === 'restart-required') this.restarts.add(result.target)
    this.result(result, retry)
  }

  private progressPage(operation: Operation): void {
    operation.panel = this.page([], [action('wait', 'Keep waiting'),
      ...(operation.requestId === undefined ? [] : [action('cancel', 'Cancel installation…')])], value => {
      if (this.operation !== operation) return
      if (value === 'cancel') this.cancelPage(operation)
      else this.progressPage(operation)
    }, () => {
      if (this.operation !== operation) return
      if (operation.requestId !== undefined) this.cancelPage(operation)
      else this.progressPage(operation)
    }, { hint: operation.requestId === undefined ? 'Applying change; please wait'
      : '↑↓ select · Enter continue · Esc cancel installation…' })
    this.renderProgress(operation)
  }

  private renderProgress(operation: Operation): void {
    if (this.disposed || this.operation !== operation) return
    const seconds = Math.floor((Date.now() - operation.started) / 1000)
    operation.panel?.updateSummary([plain(operation.title), `${operation.phase} · ${seconds}s`,
      ...operation.log.split(/\r?\n/).filter(Boolean).slice(-4)])
  }

  private cancelPage(operation: Operation): void {
    delete operation.panel
    this.page(['Cancel installation?', 'Cancellation waits for the process to exit and saved files to be restored.'],
    [action('continue', 'Continue installation'), action('cancel', 'Cancel installation')], value => {
      if (this.operation !== operation) return
      this.progressPage(operation)
      if (value === 'cancel' && !operation.cancelling && operation.requestId !== undefined) {
        operation.cancelling = true
        void this.options.manager!.cancelInstall(operation.requestId).then(result => {
          if (this.operation !== operation) return
          operation.phase = result.status === 'too-late' ? 'Already applying; waiting for the result'
            : result.status === 'not-running' ? 'Waiting for the installation result' : 'Cancellation confirmed; waiting for the result'
          this.renderProgress(operation)
        }, error => {
          if (this.operation !== operation) return
          operation.cancelling = false
          operation.phase = `Cancellation failed: ${errorText(error)}`
          this.renderProgress(operation)
        })
      }
    }, () => { if (this.operation === operation) this.progressPage(operation) })
  }

  private result(result: ChangeResult, retry?: { spec: string; options: InstallBundleOptions }): void {
    const title = {
      applied: '✓ Change applied', 'restart-required': '↻ Saved; reload required',
      overridden: '! Saved setting is overridden', failed: '! Operation failed', cancelled: 'Installation cancelled',
    }[result.application]
    this.page([title, result.target, `Stage: ${result.stage} · Saved state changed: ${result.changed ? 'Yes' : 'No'}`,
      ...(result.error === undefined ? [] : [`Error: ${result.error.code}`]),
      ...(result.application === 'applied' ? ['Check components and current Agent tools to verify availability.'] : []),
      ...(result.application === 'restart-required' ? ['Reload this session to apply changes; history will be preserved.'] : []),
      ...(result.application === 'overridden' ? ['A higher-priority configuration wins. Review profile/home/project patches.'] : []),
      ...(result.warnings?.length ? [`Warnings: ${result.warnings.length} · see diagnostics`] : []),
    ], [
      ...(result.application === 'restart-required' ? [action('reload', 'Reload session')] : []),
      action('back', result.application === 'restart-required' ? 'Later' : 'Back to plugins'),
      action('diagnostics', 'View diagnostics…'),
      ...(retry !== undefined && result.pendingBuilds?.length ? [action('approve', 'Review blocked build scripts…')] : []),
      ...(retry !== undefined && result.application === 'failed' ? [action('retry', 'Retry installation')] : []),
    ], value => {
      if (value === 'reload') this.reloadPage()
      else if (value === 'diagnostics') void this.diagnostics(result, () => { this.result(result, retry) })
      else if (value === 'approve' && retry !== undefined) {
        const names = result.pendingBuilds ?? []
        this.page([`Allow build scripts for ${names.length} packages?`, ...names.slice(0, 3),
          ...(names.length > 3 ? [`…and ${names.length - 3} more; view the full package list below.`] : []),
          'This grants persistent script permission in the dsh-code profile.'],
        [action('back', 'Cancel'), action('list', 'View full package list…'), action('allow', `Allow all ${names.length} listed packages and retry`)], selected => {
          if (selected === 'allow') void this.install(retry.spec, { ...retry.options, approvedBuilds: names })
          else if (selected === 'list') this.textPage(names, () => { this.result(result, retry) })
          else this.result(result, retry)
        }, () => { this.result(result, retry) })
      } else if (value === 'retry' && retry !== undefined) void this.install(retry.spec, retry.options)
      else void this.show()
    }, () => { void this.show() })
  }

  private reloadPage(): void {
    const reason = this.options.blocker()
    this.page(['Reload current session', 'Conversation history will be preserved.',
      ...(reason === undefined ? [] : [`Reload unavailable: ${reason}`])],
    [action('back', 'Later'), ...(reason === undefined ? [action('reload', 'Reload session')] : [])], value => {
      if (value !== 'reload') { void this.show(); return }
      if (!this.idle()) { this.reloadPage(); return }
      this.leave()
      void this.options.reload().catch(error => { if (!this.disposed) this.failure(error, () => { void this.show() }) })
    }, () => { void this.show() })
  }

  private async diagnostics(value: unknown, back: () => void): Promise<void> {
    this.page(['Loading diagnostics…'], [action('back', 'Back')], back, back)
    const revision = this.revision
    const result = value as ChangeResult | undefined
    const lines = plain(JSON.stringify(value, null, 2) ?? 'No diagnostics').split('\n')
    const path = result?.packageResult?.logPath
    if (path !== undefined) {
      try {
        const file = await open(path, 'r')
        try {
          const size = (await file.stat()).size
          const buffer = Buffer.alloc(Math.min(size, 65536))
          const { bytesRead } = await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length))
          lines.push(`Log: ${path}${size > buffer.length ? ' (last 64 KiB)' : ''}`, ...plain(buffer.subarray(0, bytesRead).toString()).split('\n'))
        } finally { await file.close() }
      } catch (error) { lines.push(`Cannot read log: ${errorText(error)}`) }
    }
    if (this.current(revision)) this.textPage(lines, back)
  }

  private textPage(lines: readonly string[], back: () => void, offset = 0): void {
    const wrapped = lines.flatMap(line => wrapTextWithAnsi(plain(line), Math.max(1, (this.options.columns?.() ?? 80) - 1)))
    this.page([`Details · ${offset + 1}–${Math.min(offset + 6, wrapped.length)} / ${wrapped.length}`,
      ...wrapped.slice(offset, offset + 6)], [action('back', 'Back'),
      ...(offset > 0 ? [action('prev', 'Previous page')] : []),
      ...(offset + 6 < wrapped.length ? [action('next', 'Next page')] : []),
    ], value => {
      if (value === 'prev') this.textPage(lines, back, offset - 6)
      else if (value === 'next') this.textPage(lines, back, offset + 6)
      else back()
    }, back)
  }

  /** Stop observers and cancel any still-cancellable install during host teardown. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.leave()
    this.unsubscribe()
    const operation = this.operation
    clearInterval(operation?.timer)
    // Even when cancellation is too late, drain the application step before teardown.
    // Mutation failures are rendered by mutate; they must not interrupt host cleanup.
    await Promise.allSettled([
      operation?.requestId === undefined ? undefined : this.options.manager?.cancelInstall(operation.requestId),
      operation?.result,
    ])
  }
}
