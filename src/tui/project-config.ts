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
  url?: string
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

/** Write the patch list, creating `.dsh-code/` when needed. */
function writePatchList(cwd: string, entries: unknown[]): void {
  const path = projectPatchPath(cwd)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, dump(entries, { lineWidth: -1 }))
}

/**
 * Add (or replace) one MCP server row in the project patch. Each server is a
 * single `insert` entry; a prior row with the same `mcp-<serverName>` id is
 * replaced rather than duplicated.
 */
export function addMcpServer(cwd: string, config: McpServerConfig): void {
  const id = `mcp-${config.serverName}`
  const configRow = config.transport === 'stdio'
    ? { transport: 'stdio', serverName: config.serverName, command: config.command, args: config.args ?? [] }
    : { transport: 'streamable-http', serverName: config.serverName, url: config.url }
  const row = { id, name: '@deepseek-ai/dsh-mcp-client', config: configRow }
  const entries = readPatchList(cwd).filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return true
    const insert = (entry as { insert?: unknown }).insert
    if (!Array.isArray(insert)) return true
    return !insert.some(child => typeof child === 'object' && child !== null && (child as { id?: unknown }).id === id)
  })
  entries.push({ insert: [row] })
  writePatchList(cwd, entries)
}

/** Remove one MCP server row from the project patch (no-op when absent). */
export function removeMcpServer(cwd: string, serverName: string): void {
  const id = `mcp-${serverName}`
  const entries = readPatchList(cwd).filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return true
    const insert = (entry as { insert?: unknown }).insert
    if (!Array.isArray(insert)) return true
    return !insert.some(child => typeof child === 'object' && child !== null && (child as { id?: unknown }).id === id)
  })
  writePatchList(cwd, entries)
}
