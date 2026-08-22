/**
 * Read/write the trusted project's `.dsh-code/cordis.patch.yml` — the project
 * patch layer that holds MCP servers and other project-local plugins. This is a
 * plain file helper, not a second configuration language: the patch is an
 * upstream Cordis patch list.
 * @module dsh-code/tui/project-config
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dump, load } from 'js-yaml'

/** One MCP server row the mcp-client plugin understands. */
export interface McpServerConfig {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** Parse cross-platform MCP argv without applying a POSIX or PowerShell shell. */
export function parseMcpArguments(input: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    throw new Error('arguments must be a JSON string array, for example ["-y","server"]')
  }
  if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) {
    throw new Error('arguments must be a JSON string array')
  }
  return parsed
}

/** Absolute path of the project patch file under `cwd`. */
export function projectPatchPath(cwd: string): string {
  return join(cwd, '.dsh-code', 'cordis.patch.yml')
}

/** Parse the patch list, tolerating an absent or empty file. */
function readPatchList(cwd: string): unknown[] {
  const path = projectPatchPath(cwd)
  if (!existsSync(path)) return []
  const parsed = load(readFileSync(path, 'utf8'))
  return Array.isArray(parsed) ? parsed : []
}

/** Return the MCP rows owned by the trusted project's dsh-code patch. */
export function listMcpServers(cwd: string): McpServerConfig[] {
  const servers: McpServerConfig[] = []
  for (const entry of readPatchList(cwd)) {
    if (typeof entry !== 'object' || entry === null) continue
    const insert = (entry as { insert?: unknown }).insert
    if (!Array.isArray(insert)) continue
    for (const child of insert) {
      if (typeof child !== 'object' || child === null) continue
      const row = child as { name?: unknown; config?: unknown }
      if (row.name !== '@deepseek-ai/dsh-mcp-client' || typeof row.config !== 'object' || row.config === null) continue
      const config = row.config as Record<string, unknown>
      if (typeof config.serverName !== 'string') continue
      if (config.transport === 'stdio' && typeof config.command === 'string') {
        servers.push({
          serverName: config.serverName,
          transport: 'stdio',
          command: config.command,
          args: Array.isArray(config.args) ? config.args.filter((value): value is string => typeof value === 'string') : [],
          env: stringRecord(config.env),
          ...(typeof config.cwd === 'string' && config.cwd !== '' ? { cwd: config.cwd } : {}),
        })
      } else if (config.transport === 'streamable-http' && typeof config.url === 'string') {
        servers.push({
          serverName: config.serverName,
          transport: 'streamable-http',
          url: config.url,
          headers: stringRecord(config.headers),
        })
      }
    }
  }
  return servers.sort((a, b) => a.serverName.localeCompare(b.serverName))
}

function withoutMcpServer(entries: unknown[], id: string): unknown[] {
  return entries.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [entry]
    const record = entry as Record<string, unknown>
    if (!Array.isArray(record.insert)) return [entry]
    const insert = record.insert.filter(child => !(
      typeof child === 'object' && child !== null && (child as { id?: unknown }).id === id
    ))
    if (insert.length === 0) return []
    return [{ ...record, insert }]
  })
}

/** Write the patch list, creating `.dsh-code/` when needed. */
function writePatchList(cwd: string, entries: unknown[]): void {
  const path = projectPatchPath(cwd)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, dump(entries, { lineWidth: -1 }), { mode: 0o600 })
}

/**
 * Add (or replace) one MCP server row in the project patch. Each server is a
 * single `insert` entry; a prior row with the same `mcp-<serverName>` id is
 * replaced rather than duplicated.
 */
export function addMcpServer(cwd: string, config: McpServerConfig): void {
  const id = `mcp-${config.serverName}`
  const configRow = config.transport === 'stdio'
    ? {
        transport: 'stdio', serverName: config.serverName, command: config.command, args: config.args ?? [],
        env: config.env ?? {}, cwd: config.cwd ?? '',
      }
    : { transport: 'streamable-http', serverName: config.serverName, url: config.url, headers: config.headers ?? {} }
  const row = { id, name: '@deepseek-ai/dsh-mcp-client', config: configRow }
  const entries = withoutMcpServer(readPatchList(cwd), id)
  entries.push({ insert: [row] })
  writePatchList(cwd, entries)
}

/** Remove one MCP server row from the project patch (no-op when absent). */
export function removeMcpServer(cwd: string, serverName: string): void {
  const id = `mcp-${serverName}`
  const entries = withoutMcpServer(readPatchList(cwd), id)
  writePatchList(cwd, entries)
}
