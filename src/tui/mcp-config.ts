/** dsh-code-owned MCP configuration, independent from imported source products. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dump } from 'js-yaml'
import type { ExternalMcpProduct } from './external-mcp.ts'
import {
  listMcpServers as listLegacyProjectMcpServers,
  removeMcpServer as removeLegacyProjectMcpServer,
  type McpServerConfig,
} from './project-config.ts'

export type McpConfigScope = 'user' | 'project'

export interface ImportedMcpOrigin {
  product: ExternalMcpProduct
  serverName: string
  sourcePath: string
}

export interface StoredMcpServer extends McpServerConfig {
  enabled: boolean
  origin?: ImportedMcpOrigin
}

export interface ManagedMcpServer extends StoredMcpServer {
  scope: McpConfigScope
  /** Whether this row owns the effective namespace after project-over-user precedence. */
  effective: boolean
}

interface McpConfigDocument {
  version: 1
  servers: StoredMcpServer[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringRecord(value: unknown): Record<string, string> {
  const input = record(value)
  return input === undefined
    ? {}
    : Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function parseOrigin(value: unknown): ImportedMcpOrigin | undefined {
  const input = record(value)
  if (input === undefined) return undefined
  if ((input.product !== 'claude' && input.product !== 'codex' && input.product !== 'dsh')
    || typeof input.serverName !== 'string'
    || typeof input.sourcePath !== 'string') return undefined
  return { product: input.product, serverName: input.serverName, sourcePath: input.sourcePath }
}

function parseServer(value: unknown): StoredMcpServer | undefined {
  const input = record(value)
  if (input === undefined || typeof input.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(input.serverName)) return undefined
  const origin = parseOrigin(input.origin)
  const common = {
    serverName: input.serverName,
    enabled: input.enabled !== false,
    ...(origin === undefined ? {} : { origin }),
  }
  if (input.transport === 'stdio' && typeof input.command === 'string' && input.command !== '') {
    return {
      ...common,
      transport: 'stdio',
      command: input.command,
      args: stringArray(input.args),
      env: stringRecord(input.env),
      ...(typeof input.cwd === 'string' && input.cwd !== '' ? { cwd: input.cwd } : {}),
    }
  }
  if (input.transport === 'streamable-http' && typeof input.url === 'string' && input.url !== '') {
    return {
      ...common,
      transport: 'streamable-http',
      url: input.url,
      headers: stringRecord(input.headers),
    }
  }
  return undefined
}

export function mcpConfigPath(home: string, cwd: string, scope: McpConfigScope): string {
  return scope === 'user' ? join(home, 'mcp.json') : join(cwd, '.dsh-code', 'mcp.json')
}

export function readMcpConfig(home: string, cwd: string, scope: McpConfigScope): StoredMcpServer[] {
  const path = mcpConfigPath(home, cwd, scope)
  if (!existsSync(path)) return []
  try {
    const parsed = record(JSON.parse(readFileSync(path, 'utf8')))
    const servers = Array.isArray(parsed?.servers) ? parsed.servers.flatMap((value) => {
      const server = parseServer(value)
      return server === undefined ? [] : [server]
    }) : []
    return servers.sort((a, b) => a.serverName.localeCompare(b.serverName))
  } catch {
    return []
  }
}

function writeMcpConfig(home: string, cwd: string, scope: McpConfigScope, servers: readonly StoredMcpServer[]): void {
  const path = mcpConfigPath(home, cwd, scope)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const document: McpConfigDocument = {
    version: 1,
    servers: [...servers].sort((a, b) => a.serverName.localeCompare(b.serverName)),
  }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

export function upsertMcpServer(
  home: string,
  cwd: string,
  scope: McpConfigScope,
  server: StoredMcpServer,
): void {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.serverName)) throw new Error('invalid MCP server name')
  const servers = readMcpConfig(home, cwd, scope).filter(candidate => candidate.serverName !== server.serverName)
  servers.push(server)
  writeMcpConfig(home, cwd, scope, servers)
}

export function removeMcpServer(home: string, cwd: string, scope: McpConfigScope, serverName: string): void {
  writeMcpConfig(home, cwd, scope, readMcpConfig(home, cwd, scope).filter(server => server.serverName !== serverName))
}

export function setMcpServerEnabled(
  home: string,
  cwd: string,
  scope: McpConfigScope,
  serverName: string,
  enabled: boolean,
): boolean {
  const servers = readMcpConfig(home, cwd, scope)
  const server = servers.find(candidate => candidate.serverName === serverName)
  if (server === undefined) return false
  server.enabled = enabled
  writeMcpConfig(home, cwd, scope, servers)
  return true
}

/** List both layers; project rows shadow user rows with the same tool namespace. */
export function listManagedMcpServers(home: string, cwd: string): ManagedMcpServer[] {
  const user = readMcpConfig(home, cwd, 'user')
  const project = readMcpConfig(home, cwd, 'project')
  const projectNames = new Set(project.map(server => server.serverName))
  return [
    ...user.map(server => ({ ...server, scope: 'user' as const, effective: !projectNames.has(server.serverName) })),
    ...project.map(server => ({ ...server, scope: 'project' as const, effective: true })),
  ]
}

/** Effective enabled rows mounted into the current dsh-code process. */
export function effectiveMcpServers(home: string, cwd: string): ManagedMcpServer[] {
  return listManagedMcpServers(home, cwd).filter(server => server.effective && server.enabled)
}

/**
 * One-way migration from the pre-0.1.1 project Cordis rows. Existing JSON
 * entries win; unrelated project patch rows are preserved by the legacy helper.
 */
export function migrateLegacyProjectMcpConfig(home: string, cwd: string): number {
  const legacy = listLegacyProjectMcpServers(cwd)
  if (legacy.length === 0) return 0
  const existing = new Set(readMcpConfig(home, cwd, 'project').map(server => server.serverName))
  for (const server of legacy) {
    if (!existing.has(server.serverName)) upsertMcpServer(home, cwd, 'project', { ...server, enabled: true })
    removeLegacyProjectMcpServer(cwd, server.serverName)
  }
  return legacy.length
}

export interface EphemeralMcpPatch {
  path: string
  dispose(): void
}

/** Materialize effective JSON rows for one headless child, then delete them after exit. */
export function createEphemeralMcpPatch(home: string, cwd: string): EphemeralMcpPatch | undefined {
  const servers = effectiveMcpServers(home, cwd)
  if (servers.length === 0) return undefined
  const runtimeRoot = join(home, 'runtime')
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 })
  const dir = mkdtempSync(join(runtimeRoot, 'mcp-'))
  const path = join(dir, 'cordis.patch.yml')
  const rows = servers.map((server) => ({
    id: `dsh-code-mcp-${server.serverName}`,
    name: '@deepseek-ai/dsh-mcp-client',
    config: server.transport === 'stdio'
      ? {
          transport: 'stdio', serverName: server.serverName, command: server.command,
          args: server.args ?? [], env: server.env ?? {}, cwd: server.cwd ?? '',
        }
      : {
          transport: 'streamable-http', serverName: server.serverName, url: server.url,
          headers: server.headers ?? {},
        },
  }))
  writeFileSync(path, dump([{ insert: rows }], { lineWidth: -1 }), { mode: 0o600 })
  return { path, dispose: () => { rmSync(dir, { recursive: true, force: true }) } }
}
