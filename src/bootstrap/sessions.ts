/**
 * Persisted-session listing for the launcher's resume flows (`-c`/`--continue`
 * and `-r`/`--resume`). The launcher reads the upstream JSONL session layout
 * directly (it never boots the TUI to list sessions): sessions live at
 * `$DSH_CODE_HOME/sessions/<projectKey(cwd)>/<sessionId>/session.jsonl.zstd`.
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
  const empty = { id: fallbackId, title: '', createdAt: undefined, dir: sessionDir, cwd: undefined }
  for (const filename of ['session.jsonl.zstd', 'session.jsonl']) {
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
    try {
      const header = JSON.parse(lines[0] ?? '{}') as { id?: unknown; createdAt?: unknown; cwd?: unknown }
      if (typeof header.id === 'string') id = header.id
      if (typeof header.createdAt === 'number') createdAt = header.createdAt
      if (typeof header.cwd === 'string') cwd = header.cwd
    } catch {
      // Malformed header — keep the directory-name id and no timestamp.
    }
    let title = ''
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index]
      if (line === undefined || line === '') continue
      let event: { type?: unknown; data?: { source?: { kind?: unknown }; content?: unknown } }
      try {
        event = JSON.parse(line) as typeof event
      } catch {
        continue
      }
      if (event.type !== 'user/message') continue
      if (event.data?.source?.kind !== 'user') continue
      title = firstUserText(event.data.content)
      break
    }
    return { id, title, createdAt, dir: sessionDir, cwd }
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
  const sessions = dirNames(projectDir).map(name => readSessionEntry(join(projectDir, name), name))
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
    for (const name of dirNames(base)) sessions.push(readSessionEntry(join(base, name), name))
  }
  return sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
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
