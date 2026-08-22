/** Hot runtime ownership for dsh-code-managed MCP servers. */

import type { Context } from '@deepseek-ai/cordis'
import * as DshMcpClient from '@deepseek-ai/dsh-mcp-client'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  effectiveMcpServers,
  listManagedMcpServers,
  type McpConfigScope,
  type StoredMcpServer,
} from './mcp-config.ts'

export type McpRuntimeState = 'disabled' | 'overridden' | 'connecting' | 'connected' | 'not-connected' | 'error'

export interface McpRuntimeSnapshot {
  scope: McpConfigScope
  serverName: string
  state: McpRuntimeState
  toolCount: number
  error?: string
  config: StoredMcpServer
}

export interface McpMountHandle {
  dispose(): Promise<void>
}

export type McpMount = (config: StoredMcpServer) => Promise<McpMountHandle>

export interface McpRuntimeManagerOptions {
  home: string
  cwd: string
  mount: McpMount
  toolNames: () => readonly string[]
  /** Zero disables polling (tests may call refreshStatus explicitly). */
  pollIntervalMs?: number
}

interface ActiveMount {
  configHash: string
  handle: McpMountHandle
}

type RuntimeDetail = { state: McpRuntimeState; error?: string }

function stdioProxyPath(): string {
  const built = fileURLToPath(new URL('./mcp-stdio-proxy.js', import.meta.url))
  return existsSync(built) ? built : fileURLToPath(new URL('./mcp-stdio-proxy.ts', import.meta.url))
}

function runtimeConfig(server: StoredMcpServer, stderrLogDir?: string): DshMcpClient.Config {
  if (server.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: server.serverName,
      command: process.execPath,
      args: [stdioProxyPath(), server.command ?? '', ...(server.args ?? [])],
      env: {
        ...(server.env ?? {}),
        ...(stderrLogDir === undefined ? {} : { DSH_CODE_MCP_STDERR_LOG: join(stderrLogDir, `${server.serverName}.stderr.log`) }),
      },
      cwd: server.cwd ?? '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
  }
  return {
    transport: 'streamable-http',
    serverName: server.serverName,
    url: server.url ?? '',
    headers: server.headers ?? {},
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}

/** Mount through the public Cordis plugin contract exposed by the upstream MCP package. */
export function cordisMcpMount(ctx: Context, options: { stderrLogDir?: string } = {}): McpMount {
  return async (server) => {
    const fiber = ctx.plugin(DshMcpClient, runtimeConfig(server, options.stderrLogDir))
    await fiber
    return { dispose: async () => { await fiber.dispose() } }
  }
}

function hashConfig(server: StoredMcpServer): string {
  return JSON.stringify(server)
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer <redacted>')
    .replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, '$1<redacted>')
}

/**
 * Owns one live upstream MCP plugin fiber per effective enabled namespace.
 * Configuration reloads are serialized and diffed, so unchanged connections
 * survive while imports, edits, toggles, and removals take effect in-process.
 */
export class McpRuntimeManager {
  private readonly active = new Map<string, ActiveMount>()
  private readonly details = new Map<string, RuntimeDetail>()
  private readonly listeners = new Set<(snapshot: McpRuntimeSnapshot[]) => void>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private reloadChain: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly options: McpRuntimeManagerOptions) {}

  async start(): Promise<void> {
    await this.reload()
    const interval = this.options.pollIntervalMs ?? 500
    if (interval > 0 && !this.disposed) {
      this.pollTimer = setInterval(() => { this.refreshStatus() }, interval)
      this.pollTimer.unref()
    }
  }

  subscribe(listener: (snapshot: McpRuntimeSnapshot[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  snapshot(): McpRuntimeSnapshot[] {
    return listManagedMcpServers(this.options.home, this.options.cwd).map((server) => {
      const key = `${server.scope}:${server.serverName}`
      const detail = this.details.get(key)
      const state: McpRuntimeState = !server.effective ? 'overridden'
        : !server.enabled ? 'disabled'
          : detail?.state ?? 'not-connected'
      return {
        scope: server.scope,
        serverName: server.serverName,
        state,
        toolCount: server.effective ? this.toolCount(server.serverName) : 0,
        ...(detail?.error === undefined ? {} : { error: detail.error }),
        config: server,
      }
    })
  }

  reload(): Promise<void> {
    const run = this.reloadChain.then(async () => { await this.reconcile() })
    this.reloadChain = run.catch(() => {})
    return run
  }

  refreshStatus(): void {
    let changed = false
    for (const server of effectiveMcpServers(this.options.home, this.options.cwd)) {
      if (!this.active.has(server.serverName)) continue
      const key = `${server.scope}:${server.serverName}`
      const next: McpRuntimeState = this.toolCount(server.serverName) > 0 ? 'connected' : 'not-connected'
      if (this.details.get(key)?.state !== next) {
        this.details.set(key, { state: next })
        changed = true
      }
    }
    if (changed) this.publish()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    await this.reloadChain
    await Promise.all([...this.active.values()].map(async mount => { await mount.handle.dispose() }))
    this.active.clear()
    this.listeners.clear()
  }

  private async reconcile(): Promise<void> {
    if (this.disposed) return
    const managed = listManagedMcpServers(this.options.home, this.options.cwd)
    const desired = new Map(effectiveMcpServers(this.options.home, this.options.cwd).map(server => [server.serverName, server]))

    for (const [serverName, mount] of [...this.active]) {
      const server = desired.get(serverName)
      if (server !== undefined && hashConfig(server) === mount.configHash) continue
      await mount.handle.dispose()
      this.active.delete(serverName)
    }

    this.details.clear()
    for (const server of managed) {
      const key = `${server.scope}:${server.serverName}`
      if (!server.effective) this.details.set(key, { state: 'overridden' })
      else if (!server.enabled) this.details.set(key, { state: 'disabled' })
      else if (this.active.has(server.serverName)) {
        this.details.set(key, { state: this.toolCount(server.serverName) > 0 ? 'connected' : 'not-connected' })
      } else {
        this.details.set(key, { state: 'connecting' })
      }
    }
    this.publish()

    for (const server of desired.values()) {
      if (this.active.has(server.serverName)) continue
      const key = `${server.scope}:${server.serverName}`
      try {
        const handle = await this.options.mount(server)
        if (this.disposed) {
          await handle.dispose()
          return
        }
        this.active.set(server.serverName, { configHash: hashConfig(server), handle })
        this.details.set(key, { state: this.toolCount(server.serverName) > 0 ? 'connected' : 'not-connected' })
      } catch (error) {
        this.details.set(key, { state: 'error', error: safeError(error) })
      }
      this.publish()
    }
  }

  private toolCount(serverName: string): number {
    const prefix = `mcp__${serverName}__`
    return this.options.toolNames().filter(name => name.startsWith(prefix)).length
  }

  private publish(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
