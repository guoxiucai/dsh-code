import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginPanel, type PluginPanelOptions } from '../../src/tui/plugin-manager.ts'
import { ListSelectorComponent, type InlineTextInputOptions, type SelectorOptions } from '../../src/tui/selector.ts'
import type { BundleInfo, ChangeResult, PluginInfo, PluginInstallLogChunk, PluginInstallProgress, PluginSpecInspection } from '@deepseek-ai/dsh-plugin-manager/types'
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'

const panels: PluginPanel[] = []
afterEach(async () => { await Promise.all(panels.splice(0).map(panel => panel.dispose())) })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}
const applied = (target = '@example/repo'): ChangeResult => ({ changed: true, application: 'applied', stage: 'enable', target })
const bundle = (values: Partial<BundleInfo> = {}): BundleInfo => ({
  name: '@example/repo', version: '1.0.0', enabled: true, installed: true, optional: false, removable: true,
  rows: [], overrides: [], ...values,
})

function harness() {
  let selector!: SelectorOptions
  let input!: InlineTextInputOptions
  let component!: ListSelectorComponent
  let log!: (chunk: PluginInstallLogChunk) => void
  let progress!: (state: PluginInstallProgress) => void
  let blocker: string | undefined
  type Manager = NonNullable<PluginPanelOptions['manager']>
  const manager = {
    listBundles: vi.fn<Manager['listBundles']>(async () => [bundle()]),
    listPlugins: vi.fn<Manager['listPlugins']>(async (): Promise<PluginInfo[]> => []),
    inspect: vi.fn<Manager['inspect']>(async (): Promise<PluginSpecInspection> => ({ status: 'accepted', kind: 'registry', name: '@example/new', version: '1.0.0', bundle: true, registry: null })),
    installBundle: vi.fn<Manager['installBundle']>(async (): Promise<ChangeResult> => applied()),
    setBundleEnabled: vi.fn<Manager['setBundleEnabled']>(async (): Promise<ChangeResult> => applied()),
    setPluginEnabled: vi.fn<Manager['setPluginEnabled']>(async (): Promise<ChangeResult> => applied()),
    removeBundle: vi.fn<Manager['removeBundle']>(async (): Promise<ChangeResult> => applied()),
    cancelInstall: vi.fn<Manager['cancelInstall']>(async () => ({ status: 'cancelled' as const })),
  }
  const host = {
    showSelector: vi.fn((options: SelectorOptions) => {
      selector = options
      component = new ListSelectorComponent(options)
      const mounted = component
      return { updateItems: (items: typeof options.items) => { mounted.updateItems(items) },
        updateSummary: (lines: readonly string[]) => { mounted.updateSummary(lines) } }
    }),
    showInlineInput: vi.fn((options: InlineTextInputOptions) => { input = options }),
    showNotice: vi.fn(), clearInlineControl: vi.fn(),
  }
  const reload = vi.fn(async () => {})
  const unsubscribe = vi.fn()
  const options: PluginPanelOptions = { manager, host, blocker: () => blocker, reload,
    tools: () => [{ name: 'read', description: 'Read a file' }],
    subscribe: (onLog, onProgress) => { log = onLog; progress = onProgress; return unsubscribe },
  }
  const panel = new PluginPanel(options)
  panels.push(panel)
  return { panel, manager, host, reload, unsubscribe,
    select: (value: string) => selector.onSelect(value),
    toggle: (value: string) => selector.onToggle?.(value),
    escape: () => selector.onCancel(),
    input: (value: string) => input.onSubmit(value),
    render: (width = 80) => component.render(width).map(stripTerminalSequences),
    log: (chunk: PluginInstallLogChunk) => log(chunk), progress: (state: PluginInstallProgress) => progress(state),
    block: (value: string | undefined) => { blocker = value },
  }
}

async function install(h: ReturnType<typeof harness>) {
  await h.panel.show()
  h.select('action:install')
  h.input('@example/new')
  await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Install plugin?') })
  h.select('enable')
}

describe('TUI plugin management', () => {
  it.each(['acp-app', 'web-app', 'headless', 'sdk-app', 'sdk-minimal'])('blocks enabling the standalone %s application bundle', async suffix => {
    const h = harness()
    const name = `@deepseek-ai/dsh-${suffix}`
    h.manager.listBundles.mockResolvedValue([bundle({ name, enabled: false, installed: false, removable: false })])
    await h.panel.show('', true)
    h.toggle(name)
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('conflicts with the TUI') })
    expect(h.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(h.render().join('\n')).not.toContain('Enable plugin')
  })

  it('does not reopen a slow list after the loading page was closed', async () => {
    const h = harness()
    const listing = deferred<BundleInfo[]>()
    h.manager.listBundles.mockReturnValue(listing.promise)
    const opened = h.panel.show()
    h.escape()
    const mounts = h.host.showSelector.mock.calls.length
    listing.resolve([bundle()])
    await opened
    expect(h.host.showSelector).toHaveBeenCalledTimes(mounts)
  })

  it('returns from built-ins to installed plugins on Esc, then closes from the top level', async () => {
    const h = harness()
    await h.panel.show()
    h.select('action:builtin')
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Plugins › Built-in') })
    expect(h.render().join('\n')).toContain('Esc back')
    h.escape()
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Plugins · Profile') })
    expect(h.render().join('\n')).toContain('@example/repo')
    expect(h.render().join('\n')).toContain('Esc close')
    const mounts = h.host.showSelector.mock.calls.length
    h.escape()
    await Promise.resolve()
    expect(h.host.showSelector).toHaveBeenCalledTimes(mounts)
  })

  it('returns to installed plugins even while built-ins are loading and ignores their late response', async () => {
    const h = harness()
    await h.panel.show()
    const listing = deferred<BundleInfo[]>()
    h.manager.listBundles.mockReturnValueOnce(listing.promise)
    const opened = h.panel.show('', true)
    h.escape()
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Plugins · Profile') })
    const mounts = h.host.showSelector.mock.calls.length
    listing.resolve([bundle({ installed: false })])
    await opened
    expect(h.host.showSelector).toHaveBeenCalledTimes(mounts)
    expect(h.render().join('\n')).not.toContain('Plugins › Built-in')
  })

  it('separates installed bundles from built-ins and shows saved versus runtime state', async () => {
    const h = harness()
    h.manager.listBundles.mockResolvedValue([
      bundle(), bundle({ name: '@example/broken', error: { code: 'operation-error', diagnostic: 'broken manifest' } }),
      bundle({ name: '@deepseek-ai/dsh-base', installed: false, removable: false, readOnlyReason: 'management-required' }),
    ])
    await h.panel.show()
    expect(h.render().join('\n')).toContain('On · Selected; see components')
    expect(h.render().join('\n')).toContain('Load failed')
    expect(h.render().join('\n')).not.toContain('@deepseek-ai/dsh-base')
    h.select('action:builtin')
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('@deepseek-ai/dsh-base') })
    h.toggle('@deepseek-ai/dsh-base')
    expect(h.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('discards a late inspection after Esc and passes an aborted signal upstream', async () => {
    const h = harness()
    const inspection = deferred<PluginSpecInspection>()
    h.manager.inspect.mockReturnValue(inspection.promise)
    await h.panel.show()
    h.select('action:install')
    h.input('@example/new')
    h.escape()
    expect(h.manager.inspect.mock.calls[0]?.[2]?.aborted).toBe(true)
    const mounts = h.host.showSelector.mock.calls.length
    inspection.resolve({ status: 'accepted', kind: 'registry', name: '@example/new', bundle: true, registry: null })
    await Promise.resolve()
    expect(h.host.showSelector).toHaveBeenCalledTimes(mounts)
    expect(h.manager.installBundle).not.toHaveBeenCalled()
  })

  it('holds the mutation lock until upstream settles cancellation and filters log request ids', async () => {
    const h = harness()
    const operation = deferred<ChangeResult>()
    h.manager.installBundle.mockReturnValue(operation.promise)
    await install(h)
    const requestId = h.manager.installBundle.mock.calls[0]![1]!.requestId!
    h.log({ requestId, jobId: 'test', cwd: '/tmp', argv: ['add'], stream: 'stdout', text: '\x1b[31mdownloaded\x1b[0m\n' })
    expect(h.render().join('\n')).toContain('downloaded')
    h.log({ jobId: 'other', cwd: '/tmp', argv: [], stream: 'stdout', text: 'unrelated' })
    expect(h.render().join('\n')).not.toContain('unrelated')
    h.escape()
    h.select('cancel')
    await Promise.resolve()
    expect(h.manager.cancelInstall).toHaveBeenCalledWith(requestId)
    expect(h.panel.busy).toBe(true)
    operation.resolve({ ...applied(), application: 'cancelled', stage: 'install' })
    await vi.waitFor(() => { expect(h.panel.busy).toBe(false) })
    expect(h.render().join('\n')).toContain('Installation cancelled')
  })

  it('requires explicit script approval and does not reuse it on subsequent retries', async () => {
    const h = harness()
    h.manager.installBundle.mockResolvedValue({ ...applied(), application: 'failed', stage: 'install', pendingBuilds: ['native-helper'] })
    await install(h)
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Review blocked build scripts') })
    h.select('approve')
    expect(h.render().join('\n')).toContain('native-helper')
    expect(h.manager.installBundle).toHaveBeenCalledTimes(1)
    h.select('allow')
    await vi.waitFor(() => { expect(h.manager.installBundle).toHaveBeenCalledTimes(2) })
    expect(h.manager.installBundle).toHaveBeenLastCalledWith('@example/new', expect.objectContaining({ approvedBuilds: ['native-helper'] }))
    await vi.waitFor(() => { expect(h.panel.busy).toBe(false) })
    h.select('retry')
    await vi.waitFor(() => { expect(h.manager.installBundle).toHaveBeenCalledTimes(3) })
    expect(h.manager.installBundle.mock.calls.at(-1)![1]).not.toHaveProperty('approvedBuilds')
  })

  it('drains an applying installation on teardown even when cancellation is too late', async () => {
    const h = harness()
    const operation = deferred<ChangeResult>()
    h.manager.installBundle.mockReturnValue(operation.promise)
    h.manager.cancelInstall.mockResolvedValue({ status: 'too-late' })
    await install(h)
    let disposed = false
    const closing = h.panel.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    operation.resolve(applied())
    await closing
    expect(h.panel.busy).toBe(false)
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })

  it('preserves a disabled bundle on update and offers history-preserving reload', async () => {
    const h = harness()
    h.manager.listBundles.mockResolvedValue([bundle({ enabled: false })])
    h.manager.installBundle.mockResolvedValue({ ...applied(), application: 'restart-required' })
    await h.panel.show()
    h.select('@example/repo')
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Update version') })
    h.select('update')
    h.input('1.2.3')
    h.select('update')
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Saved; reload required') })
    expect(h.manager.installBundle).toHaveBeenCalledWith('@example/repo@1.2.3', expect.objectContaining({ enabled: false }))
    expect(h.manager.inspect).not.toHaveBeenCalled()
    h.select('reload')
    h.select('reload')
    expect(h.reload).toHaveBeenCalledOnce()
  })

  it('blocks mutations and reload while a job is active, but allows browsing', async () => {
    const h = harness()
    h.block('a background job is running')
    await h.panel.show()
    h.toggle('@example/repo')
    expect(h.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(h.host.showNotice).toHaveBeenCalledWith(expect.stringContaining('background job'))
  })

  it('protects the TUI row even when upstream regards it as editable', async () => {
    const h = harness()
    const entryId = 'include:dsh-code-tui' as PluginInfo['entryId']
    h.manager.listBundles.mockResolvedValue([bundle({ rows: [{ rowId: 'dsh-code-tui', moduleName: 'file:///tui.js', entryId }] })])
    h.manager.listPlugins.mockResolvedValue([{ entryId, patchId: 'dsh-code-tui', moduleName: 'file:///tui.js', enabled: true, fiberPhase: 'active' }])
    await h.panel.show()
    h.select('@example/repo')
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('View components') })
    h.select('components')
    h.select('dsh-code-tui')
    expect(h.render().join('\n')).toContain('Required by dsh-code')
    expect(h.render().join('\n')).not.toContain('Disable component')
  })

  it('retains partial-failure diagnostics instead of claiming an uninstall rolled back', async () => {
    const h = harness()
    h.manager.removeBundle.mockResolvedValue({ ...applied(), stage: 'remove', application: 'failed', error: { code: 'bundle-in-use' } })
    await h.panel.show()
    h.select('@example/repo')
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Uninstall') })
    h.select('remove')
    expect(h.render().find(line => line.includes('→'))).toContain('Cancel')
    h.select('remove')
    await vi.waitFor(() => { expect(h.render().join('\n')).toContain('Operation failed') })
    expect(h.render().join('\n')).toContain('Saved state changed: Yes')
    expect(h.render().join('\n')).toContain('bundle-in-use')
  })

  it('renders a narrow list and shows actual Agent tools without inventing ownership', async () => {
    const h = harness()
    await h.panel.show()
    expect(h.render(36).every(line => visibleWidth(line) <= 36)).toBe(true)
    h.select('action:tools')
    expect(h.render().join('\n')).toContain('ownership is not inferred')
    expect(h.render().join('\n')).toContain('read')
    await h.panel.dispose()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })
})
