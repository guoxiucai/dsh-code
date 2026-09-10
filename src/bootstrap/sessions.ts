/**
 * Persisted-session listing for the launcher's resume flows (`-c`/`--continue`
 * and `-r`/`--resume`). The launcher reads the upstream JSONL session layout
 * directly (it never boots the TUI to list sessions): sessions live at
 * `$DSH_CODE_HOME/sessions/<projectKey(cwd)>/<sessionId>/session.v3.jsonl.zstd`.
 *
 * `projectKey` mirrors `@deepseek-ai/dsh-session-persistence-jsonl`'s
 * `projectKey` byte-for-byte and must stay in sync on a baseline upgrade.
 * @module dsh-code/bootstrap/sessions
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Zstandard frame magic number (bytes `28 B5 2F FD` little-endian). */
const ZSTD_MAGIC = 0xFD2FB528

/** Byte range of one complete Zstandard frame within the artifact. */
interface ZstdFrameRange { start: number; end: number }

/**
 * Locate complete Zstandard frame boundaries in a concatenated-frame artifact.
 * Mirrors the upstream backend's `scanZstdFrames`; unlike it, structural
 * problems stop the scan (best-effort) rather than throwing, so a corrupt or
 * torn session never aborts the launcher's listing.
 */
function scanZstdFrames(buffer: Buffer): ZstdFrameRange[] {
  const frames: ZstdFrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return frames
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** Decompress every Zstandard frame of a session artifact into its JSONL text. */
function decodeSessionLog(raw: Buffer): string {
  let out = ''
  for (const { start, end } of scanZstdFrames(raw)) {
    out += zstdDecompressSync(raw.subarray(start, end)).toString('utf8')
  }
  return out
}

/**
 * Build the upstream project directory key for a project path (lossy, bounded,
 * human-navigable). Mirrors the persistence backend's `projectKey`.
 */
export function projectKey(cwd: string): string {
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/** One persisted session, for the resume picker and `--continue`. */
export interface ProjectSession {
  /** Raw session id from the log header (directory name fallback). */
  id: string
  /** First human `user/message` text, single-line, empty when absent. */
  title: string
  /** Epoch ms from the log header, `undefined` when unreadable. */
  createdAt: number | undefined
  /** Absolute path to the session directory (deletion target). */
  dir: string
  /** The session's project path from the log header, `undefined` when absent. */
  cwd: string | undefined
  /** Parent Session id recorded by an ordinary fork/clone, when present. */
  parentSession?: string
  /** Durable owner marker; `subagent` sessions are hidden from launcher resume flows. */
  origin?: 'subagent'
  /** Unreadable or unsupported artifacts must never be treated as empty for cleanup. */
  unreadable?: true
  /** A human message with no text (for example an attachment) still owns history. */
  hasNonTextPrompt?: true
}

/** One resume-picker row after parent/child lineage ordering. */
export interface ProjectSessionLineageEntry extends ProjectSession {
  depth: number
}

/** Join the text blocks of a message into one normalized, single-line string. */
function firstUserText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const entry = block as { type?: unknown; text?: unknown }
    if (entry.type === 'text' && typeof entry.text === 'string') out += entry.text
  }
  return out.replace(/\s+/g, ' ').trim()
}

function readSessionEntry(sessionDir: string, fallbackId: string): ProjectSession {
  const empty = { id: fallbackId, title: '', createdAt: undefined, dir: sessionDir, cwd: undefined, unreadable: true as const }
  // A successor is authoritative: never fall back to a stale predecessor.
  let names: string[]
  try { names = readdirSync(sessionDir) } catch { return empty }
  const generations = names.flatMap(name => {
    const match = /^session(?:\.v([1-9][0-9]*))?\.jsonl(?:\.zstd)?$/.exec(name)
    const version = match === null ? NaN : Number(match[1] ?? 0)
    return Number.isSafeInteger(version) ? [{ name, version }] : []
  }).sort((a, b) => b.version - a.version || Number(b.name.endsWith('.zstd')) - Number(a.name.endsWith('.zstd')))
  for (const { name: filename, version } of generations.slice(0, 1)) {
    if (version > 3) return empty
    const path = join(sessionDir, filename)
    if (!existsSync(path)) continue
    let text: string
    try {
      const raw = readFileSync(path)
      text = filename.endsWith('.zstd') ? decodeSessionLog(raw) : raw.toString('utf8')
    } catch {
      return empty
    }
    const lines = text.split('\n')
    let id = fallbackId
    let createdAt: number | undefined
    let cwd: string | undefined
    let parentSession: string | undefined
    let origin: 'subagent' | undefined
    let unreadable = false
    try {
      const header = JSON.parse(lines[0] ?? '{}') as {
        id?: unknown
        createdAt?: unknown
        cwd?: unknown
        parentSession?: unknown
        origin?: unknown
      }
      if (typeof header.id === 'string') id = header.id
      if (typeof header.createdAt === 'number') createdAt = header.createdAt
      if (typeof header.cwd === 'string') cwd = header.cwd
      if (typeof header.parentSession === 'string') parentSession = header.parentSession
      if (header.origin === 'subagent') origin = header.origin
      if (typeof header.id !== 'string' || typeof header.createdAt !== 'number') unreadable = true
    } catch {
      // Malformed header — keep the directory-name id and no timestamp.
      unreadable = true
    }
    let title = ''
    let hasNonTextPrompt = false
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index]
      if (line === undefined || line === '') continue
      let event: { type?: unknown; data?: { source?: { kind?: unknown }; content?: unknown } }
      try {
        event = JSON.parse(line) as typeof event
      } catch {
        unreadable = true
        continue
      }
      if (event.type !== 'user/message') continue
      if (event.data?.source?.kind !== 'user') continue
      title = firstUserText(event.data.content)
      hasNonTextPrompt = title === ''
      break
    }
    return {
      id,
      title,
      createdAt,
      dir: sessionDir,
      cwd,
      ...(parentSession === undefined ? {} : { parentSession }),
      ...(origin === undefined ? {} : { origin }),
      ...(unreadable ? { unreadable: true as const } : {}),
      ...(hasNonTextPrompt ? { hasNonTextPrompt: true as const } : {}),
    }
  }
  return empty
}

/** Directory names directly beneath `base` (empty on any read failure). */
function dirNames(base: string): string[] {
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * List the persisted sessions belonging to `cwd` (most recent first). The
 * launcher has no persistence service, so this reads the directory layout.
 */
export function listProjectSessions(home: string, cwd: string): ProjectSession[] {
  const projectDir = join(home, 'sessions', projectKey(cwd))
  const sessions = dirNames(projectDir)
    .map(name => readSessionEntry(join(projectDir, name), name))
    .filter(session => session.origin !== 'subagent')
  return sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/**
 * List every persisted session across all project directories (most recent
 * first), for the picker's "All Folder" scope.
 */
export function listAllSessions(home: string): ProjectSession[] {
  const sessionsRoot = join(home, 'sessions')
  const sessions: ProjectSession[] = []
  for (const projectDir of dirNames(sessionsRoot)) {
    const base = join(sessionsRoot, projectDir)
    for (const name of dirNames(base)) {
      const session = readSessionEntry(join(base, name), name)
      if (session.origin !== 'subagent') sessions.push(session)
    }
  }
  return sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/**
 * Select Sessions introduced by one external surface lease that still contain
 * no human prompt. Existing empty Sessions are deliberately excluded: the
 * caller does not own their lifecycle.
 */
export function newlyCreatedEmptySessions(
  beforeIds: ReadonlySet<string>,
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  return sessions.filter(session => !beforeIds.has(session.id) && session.title === '' && !session.unreadable && !session.hasNonTextPrompt)
}

/**
 * Order sessions as parent-first families and annotate their nesting depth.
 * Families with the newest activity appear first; missing parents and cycles
 * degrade to roots so every Session remains resumable.
 */
export function sessionLineage(sessions: readonly ProjectSession[]): ProjectSessionLineageEntry[] {
  const byId = new Map(sessions.map(session => [session.id, session]))
  const children = new Map<string, ProjectSession[]>()
  const familyActivity = new Map(sessions.map(session => [session.id, session.createdAt ?? 0]))
  const roots: ProjectSession[] = []

  for (const session of sessions) {
    const parentId = session.parentSession
    if (parentId === undefined || !byId.has(parentId) || parentId === session.id) {
      roots.push(session)
      continue
    }
    const siblings = children.get(parentId) ?? []
    siblings.push(session)
    children.set(parentId, siblings)

    const seen = new Set<string>([session.id])
    let ancestorId: string | undefined = parentId
    while (ancestorId !== undefined && !seen.has(ancestorId)) {
      seen.add(ancestorId)
      familyActivity.set(ancestorId, Math.max(familyActivity.get(ancestorId) ?? 0, session.createdAt ?? 0))
      ancestorId = byId.get(ancestorId)?.parentSession
    }
  }

  const newestFirst = (left: ProjectSession, right: ProjectSession): number =>
    (familyActivity.get(right.id) ?? 0) - (familyActivity.get(left.id) ?? 0)
      || (right.createdAt ?? 0) - (left.createdAt ?? 0)
      || left.id.localeCompare(right.id)
  roots.sort(newestFirst)
  for (const siblings of children.values()) siblings.sort(newestFirst)

  const result: ProjectSessionLineageEntry[] = []
  const visited = new Set<string>()
  const appendTree = (root: ProjectSession): void => {
    const stack: Array<{ session: ProjectSession; depth: number }> = [{ session: root, depth: 0 }]
    while (stack.length > 0) {
      const current = stack.pop()
      if (current === undefined || visited.has(current.session.id)) continue
      visited.add(current.session.id)
      result.push({ ...current.session, depth: current.depth })
      const descendants = children.get(current.session.id) ?? []
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index]
        if (child !== undefined) stack.push({ session: child, depth: current.depth + 1 })
      }
    }
  }
  for (const root of roots) appendTree(root)
  // A pure cycle has no root. Emit its members once at root level instead of hiding them.
  for (const session of sessions) if (!visited.has(session.id)) appendTree(session)
  return result
}

/**
 * Best-effort deletion of one persisted session directory. Returns whether the
 * directory was removed (or already absent).
 */
export function deleteSession(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** Delete one ordinary Session id in a known project without constructing a path from untrusted input. */
export function deleteProjectSession(home: string, cwd: string, sessionId: string): boolean {
  const session = listProjectSessions(home, cwd).find(candidate => candidate.id === sessionId)
  return session === undefined || deleteSession(session.dir)
}
