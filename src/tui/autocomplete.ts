/**
 * Product autocomplete adapter. pi-tui remains authoritative for command and
 * path completion; this module adds an in-process fallback for `@` fuzzy file
 * references when the optional `fd` executable is unavailable.
 * @module dsh-code/tui/autocomplete
 */

import { readdir } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import {
  CombinedAutocompleteProvider,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type SlashCommand,
} from '@earendil-works/pi-tui'

const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage'])
const MAX_VISITED_ENTRIES = 10_000
const MAX_SUGGESTIONS = 20

interface FileEntry {
  path: string
  isDirectory: boolean
}

function displayPath(path: string): string {
  return path.split(sep).join('/')
}

function extractAtPrefix(text: string): string | undefined {
  let tokenStart = 0
  let quoteStart: number | undefined
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') quoteStart = quoteStart === undefined ? index : undefined
    if (quoteStart === undefined && (character === ' ' || character === '\t' || character === "'" || character === '=')) {
      tokenStart = index + 1
    }
  }
  const token = text.slice(tokenStart)
  if (token.startsWith('@')) return token
  if (quoteStart !== undefined && quoteStart > 0 && text[quoteStart - 1] === '@') {
    return text.slice(quoteStart - 1)
  }
  return undefined
}

function rawAtQuery(prefix: string): { query: string; quoted: boolean } {
  if (prefix.startsWith('@"')) return { query: prefix.slice(2), quoted: true }
  return { query: prefix.slice(1), quoted: false }
}

function fuzzyScore(path: string, query: string, isDirectory: boolean): number {
  if (query === '') return isDirectory ? 2 : 1
  const candidate = path.toLowerCase()
  const leaf = basename(path).toLowerCase()
  const needle = query.toLowerCase().replace(/\\/g, '/')
  let score = leaf === needle ? 120 : leaf.startsWith(needle) ? 100
    : leaf.includes(needle) ? 80 : candidate.includes(needle) ? 60 : 0
  if (score === 0) {
    let cursor = 0
    for (const character of candidate) {
      if (character === needle[cursor]) cursor += 1
      if (cursor === needle.length) { score = 30; break }
    }
  }
  if (score > 0 && isDirectory) score += 5
  return score
}

function completionValue(path: string, isDirectory: boolean, quoted: boolean): string {
  const completedPath = `${path}${isDirectory ? '/' : ''}`
  if (quoted || completedPath.includes(' ')) return `@"${completedPath}"`
  return `@${completedPath}`
}

async function scanWorkspace(basePath: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  const pending = [basePath]
  let visited = 0
  while (pending.length > 0 && visited < MAX_VISITED_ENTRIES) {
    const directory = pending.shift()
    if (directory === undefined) break
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      if (visited >= MAX_VISITED_ENTRIES) break
      visited += 1
      if (child.isSymbolicLink()) continue
      const absolute = join(directory, child.name)
      const path = displayPath(relative(basePath, absolute))
      if (child.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(child.name)) continue
        entries.push({ path, isDirectory: true })
        pending.push(absolute)
      } else if (child.isFile()) {
        entries.push({ path, isDirectory: false })
      }
    }
  }
  return entries
}

class DshAutocompleteProvider implements AutocompleteProvider {
  readonly triggerCharacters = ['/', '.', '~', '@']
  private readonly upstream: CombinedAutocompleteProvider
  private workspaceEntries: Promise<FileEntry[]> | undefined

  constructor(commands: readonly SlashCommand[], private readonly basePath: string, fdPath?: string) {
    this.upstream = new CombinedAutocompleteProvider([...commands], basePath, fdPath ?? null)
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const upstream = await this.upstream.getSuggestions(lines, cursorLine, cursorCol, options)
    if (upstream !== null || options.signal.aborted) return upstream
    const currentLine = lines[cursorLine] ?? ''
    const prefix = extractAtPrefix(currentLine.slice(0, cursorCol))
    if (prefix === undefined) return null
    const { query, quoted } = rawAtQuery(prefix)
    // Keep one bounded workspace snapshot for the provider lifetime. Editor
    // requests are routinely aborted as the user types; tying the shared scan
    // to the first request's signal would cache an accidentally partial tree.
    this.workspaceEntries ??= scanWorkspace(this.basePath)
    const entries = await this.workspaceEntries
    if (options.signal.aborted) return null
    const items = entries
      .map(entry => ({ entry, score: fuzzyScore(entry.path, query, entry.isDirectory) }))
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path))
      .slice(0, MAX_SUGGESTIONS)
      .map(({ entry }): AutocompleteItem => ({
        value: completionValue(entry.path, entry.isDirectory, quoted),
        label: `${basename(entry.path)}${entry.isDirectory ? '/' : ''}`,
        description: entry.path,
      }))
    return items.length === 0 ? null : { items, prefix }
  }

  applyCompletion(
    lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return this.upstream.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    return this.upstream.shouldTriggerFileCompletion(lines, cursorLine, cursorCol)
  }
}

export function createAutocompleteProvider(
  commands: readonly SlashCommand[], basePath: string, fdPath?: string,
): AutocompleteProvider {
  return new DshAutocompleteProvider(commands, basePath, fdPath)
}
