/**
 * Persisted-session listing for the launcher's `dsh-code resume` selector. The
 * launcher reads the upstream JSONL session layout directly (it never boots the
 * TUI to list sessions): sessions live at
 * `$DSH_CODE_HOME/sessions/<projectKey(cwd)>/<sessionId>/session.jsonl.zstd`.
 *
 * `projectKey` mirrors `@deepseek-ai/dsh-session-persistence-jsonl`'s
 * `projectKey` byte-for-byte and must stay in sync on a baseline upgrade.
 * @module dsh-code/bootstrap/sessions
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { zstdDecompressSync } from 'node:zlib'

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

/** One persisted session for the current project, for the resume selector. */
export interface ProjectSession {
  id: string
  createdAt: number | undefined
}

/** Best-effort read of a session header's `createdAt` from its log artifact. */
function readCreatedAt(sessionDir: string): number | undefined {
  for (const filename of ['session.jsonl.zstd', 'session.jsonl']) {
    const path = join(sessionDir, filename)
    if (!existsSync(path)) continue
    try {
      const raw = readFileSync(path)
      const text = filename.endsWith('.zstd') ? zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8')
      const header = JSON.parse(text.split('\n')[0] ?? '{}') as { createdAt?: unknown }
      return typeof header.createdAt === 'number' ? header.createdAt : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * List the persisted sessions belonging to `cwd` (most recent first). The
 * launcher has no persistence service, so this reads the directory layout.
 */
export function listProjectSessions(home: string, cwd: string): ProjectSession[] {
  const projectDir = join(home, 'sessions', projectKey(cwd))
  if (!existsSync(projectDir)) return []
  let names: string[]
  try {
    names = readdirSync(projectDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
  const sessions = names.map(name => ({ id: name, createdAt: readCreatedAt(join(projectDir, name)) }))
  return sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/**
 * Interactive session selector. Resolves the chosen session id, or `undefined`
 * when the user starts a new session (empty/Enter input or an out-of-range
 * choice). Never throws on stream errors — a broken terminal falls through to
 * a fresh session.
 */
export function selectSession(sessions: readonly ProjectSession[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let rl: ReturnType<typeof createInterface>
    try {
      rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    } catch {
      resolve(undefined)
      return
    }
    const lines = sessions.map((session, index) => {
      const when = session.createdAt !== undefined ? new Date(session.createdAt).toLocaleString() : ''
      return `  ${index + 1}. ${session.id}${when !== '' ? ` (${when})` : ''}`
    })
    const text = ['Sessions in this project:', ...lines, '  [Enter] start a new session', '> '].join('\n')
    rl.question(text, (answer) => {
      rl.close()
      const value = answer.trim()
      if (value === '') { resolve(undefined); return }
      const index = Number.parseInt(value, 10) - 1
      if (Number.isInteger(index) && index >= 0 && index < sessions.length) resolve(sessions[index]?.id)
      else resolve(undefined)
    })
  })
}
