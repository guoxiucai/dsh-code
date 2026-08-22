/** Read-only MCP discovery for standalone DSH, Codex, and Claude configs. */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DEFAULT_SCHEMA, load, Type } from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { skillProjectRoot } from '../bootstrap/profile.ts'
import type { McpServerConfig } from './project-config.ts'

export type ExternalMcpProduct = 'dsh' | 'codex' | 'claude'
export type ExternalMcpScope = 'project' | 'user' | 'profile' | 'local'

export interface DiscoveredMcpServer extends McpServerConfig {
  id: string
  product: ExternalMcpProduct
  scope: ExternalMcpScope
  sourcePath: string
  sourceEnabled: boolean
  warnings: string[]
}

export interface DiscoverMcpOptions {
  cwd: string
  userHome?: string
}

type UnknownRecord = Record<string, unknown>

const dshYamlSchema = DEFAULT_SCHEMA.extend([
  new Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    construct: expression => ({ expression }),
  }),
])

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringRecord(value: unknown): Record<string, string> {
  const input = record(value)
  if (input === undefined) return {}
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function safeName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  return normalized === '' ? 'external-mcp' : normalized
}

function sourceId(product: ExternalMcpProduct, path: string, name: string): string {
  return `${product}\u0000${resolve(path)}\u0000${name}`
}

function normalizeServer(
  product: ExternalMcpProduct,
  scope: ExternalMcpScope,
  path: string,
  name: string,
  value: unknown,
  warnings: string[] = [],
): DiscoveredMcpServer | undefined {
  const config = record(value)
  if (config === undefined) return undefined
  const serverName = safeName(name)
  const sourceEnabled = config.enabled !== false && config.disabled !== true
  const command = typeof config.command === 'string' ? config.command : undefined
  if (command !== undefined) {
    return {
      id: sourceId(product, path, name), product, scope, sourcePath: path, sourceEnabled, warnings,
      serverName, transport: 'stdio', command, args: stringArray(config.args),
      env: stringRecord(config.env),
      ...(typeof config.cwd === 'string' ? { cwd: config.cwd } : {}),
    }
  }
  const url = typeof config.url === 'string' ? config.url : undefined
  if (url === undefined) return undefined
  const headers = stringRecord(config.headers ?? config.http_headers)
  return {
    id: sourceId(product, path, name), product, scope, sourcePath: path, sourceEnabled, warnings,
    serverName, transport: 'streamable-http', url, headers,
  }
}

function readJson(path: string): UnknownRecord | undefined {
  if (!existsSync(path)) return undefined
  try { return record(JSON.parse(readFileSync(path, 'utf8'))) } catch { return undefined }
}

function fromMcpServers(product: ExternalMcpProduct, scope: ExternalMcpScope, path: string, value: unknown): DiscoveredMcpServer[] {
  const servers = record(record(value)?.mcpServers)
  if (servers === undefined) return []
  return Object.entries(servers).flatMap(([name, config]) => {
    const normalized = normalizeServer(product, scope, path, name, config)
    return normalized === undefined ? [] : [normalized]
  })
}

function discoverClaude(projectRoot: string, userHome: string): DiscoveredMcpServer[] {
  const result: DiscoveredMcpServer[] = []
  const userPath = join(userHome, '.claude.json')
  const user = readJson(userPath)
  result.push(...fromMcpServers('claude', 'user', userPath, user))
  const projectConfig = record(record(user?.projects)?.[projectRoot])
  result.push(...fromMcpServers('claude', 'local', userPath, projectConfig))
  for (const [path, scope] of [
    [join(projectRoot, '.mcp.json'), 'project'],
    [join(projectRoot, '.claude', 'settings.json'), 'project'],
    [join(userHome, '.claude', 'settings.json'), 'user'],
  ] as const) {
    result.push(...fromMcpServers('claude', scope, path, readJson(path)))
  }
  return result
}

function discoverCodex(projectRoot: string, userHome: string): DiscoveredMcpServer[] {
  const result: DiscoveredMcpServer[] = []
  for (const [path, scope] of [
    [join(projectRoot, '.codex', 'config.toml'), 'project'],
    [join(userHome, '.codex', 'config.toml'), 'user'],
  ] as const) {
    if (!existsSync(path)) continue
    let parsed: UnknownRecord | undefined
    try { parsed = record(parseToml(readFileSync(path, 'utf8'))) } catch { continue }
    const servers = record(parsed?.mcp_servers)
    if (servers === undefined) continue
    for (const [name, value] of Object.entries(servers)) {
      const config = record(value)
      if (config === undefined) continue
      const adjusted: UnknownRecord = { ...config }
      const warnings: string[] = []
      if (typeof config.command === 'string') {
        const env = stringRecord(config.env)
        for (const envName of stringArray(config.env_vars)) {
          const current = process.env[envName]
          if (current === undefined) warnings.push(`environment variable ${envName} is not set`)
          else env[envName] = current
        }
        adjusted.env = env
      } else if (typeof config.url === 'string') {
        const headers = stringRecord(config.http_headers)
        const bearerName = typeof config.bearer_token_env_var === 'string' ? config.bearer_token_env_var : undefined
        if (bearerName !== undefined) {
          const token = process.env[bearerName]
          if (token === undefined) warnings.push(`bearer token environment variable ${bearerName} is not set`)
          else headers.Authorization = `Bearer ${token}`
        }
        for (const [header, envName] of Object.entries(stringRecord(config.env_http_headers))) {
          const current = process.env[envName]
          if (current === undefined) warnings.push(`header environment variable ${envName} is not set`)
          else headers[header] = current
        }
        if (config.auth === 'oauth') warnings.push('Codex OAuth credentials cannot be shared; configure an environment-backed token')
        adjusted.headers = headers
      }
      const normalized = normalizeServer('codex', scope, path, name, adjusted, warnings)
      if (normalized !== undefined) result.push(normalized)
    }
  }
  return result
}

function walkDshRows(value: unknown, path: string, scope: ExternalMcpScope, output: DiscoveredMcpServer[]): void {
  if (Array.isArray(value)) {
    for (const child of value) walkDshRows(child, path, scope, output)
    return
  }
  const row = record(value)
  if (row === undefined) return
  if (row.name === '@deepseek-ai/dsh-mcp-client') {
    const config = record(row.config)
    const name = typeof config?.serverName === 'string' ? config.serverName : undefined
    if (name !== undefined) {
      const normalized = normalizeServer('dsh', scope, path, name, config)
      if (normalized !== undefined) output.push(normalized)
    }
  }
  for (const child of Object.values(row)) walkDshRows(child, path, scope, output)
}

function discoverDsh(projectRoot: string, userHome: string): DiscoveredMcpServer[] {
  const files: Array<{ path: string; scope: ExternalMcpScope }> = [
    { path: join(projectRoot, '.dsh', 'cordis.yml'), scope: 'project' },
    { path: join(projectRoot, '.dsh', 'cordis.patch.yml'), scope: 'project' },
    { path: join(userHome, '.dsh', 'cordis.yml'), scope: 'user' },
    { path: join(userHome, '.dsh', 'cordis.patch.yml'), scope: 'user' },
  ]
  const profiles = join(userHome, '.dsh', 'profiles')
  if (existsSync(profiles)) {
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      files.push({ path: join(profiles, entry.name, 'cordis.yml'), scope: 'profile' })
      files.push({ path: join(profiles, entry.name, 'cordis.patch.yml'), scope: 'profile' })
    }
  }
  const result: DiscoveredMcpServer[] = []
  for (const file of files) {
    if (!existsSync(file.path)) continue
    try { walkDshRows(load(readFileSync(file.path, 'utf8'), { schema: dshYamlSchema }), file.path, file.scope, result) } catch { /* invalid configs stay owned by DSH */ }
  }
  return result
}

/** Discover without mutating any source product configuration. */
export function discoverExternalMcpServers(options: DiscoverMcpOptions): DiscoveredMcpServer[] {
  const userHome = options.userHome ?? homedir()
  const projectRoot = skillProjectRoot(options.cwd)
  const found = [
    ...discoverDsh(projectRoot, userHome),
    ...discoverCodex(projectRoot, userHome),
    ...discoverClaude(projectRoot, userHome),
  ]
  const seen = new Set<string>()
  return found.filter((server) => {
    if (seen.has(server.id)) return false
    seen.add(server.id)
    return true
  }).sort((a, b) => a.product.localeCompare(b.product) || a.serverName.localeCompare(b.serverName) || a.sourcePath.localeCompare(b.sourcePath))
}

export function externalMcpLocation(server: DiscoveredMcpServer, userHome = homedir()): string {
  const path = server.sourcePath.startsWith(`${userHome}/`) ? `~/${server.sourcePath.slice(userHome.length + 1)}` : server.sourcePath
  return `${server.product} · ${server.scope} · ${basename(path) === '.claude.json' ? '~/.claude.json' : path}`
}

/** Human-facing source heading used by the grouped MCP selector. */
export function externalMcpSourceLabel(server: DiscoveredMcpServer, userHome = homedir()): string {
  const path = server.sourcePath.startsWith(`${userHome}/`)
    ? `~/${server.sourcePath.slice(userHome.length + 1)}`
    : server.sourcePath
  const product = server.product === 'claude' ? 'Claude Code'
    : server.product === 'codex' ? 'OpenAI Codex'
      : 'DSH'
  return `${product} (${path}):`
}

/** Derive live MCP server names from the Tool Registry's model-facing schemas. */
export function connectedMcpServerNames(toolNames: readonly string[]): Set<string> {
  const result = new Set<string>()
  for (const toolName of toolNames) {
    const serverName = /^mcp__([A-Za-z0-9_-]{1,32})__/.exec(toolName)?.[1]
    if (serverName !== undefined) result.add(serverName)
  }
  return result
}
