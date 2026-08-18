/**
 * Project trust gate. No project-level plugin, MCP command, skill, or
 * `.dsh-code` patch may load before the project is trusted; trust binds only to
 * the canonical absolute path (`projectId = sha256(canonicalAbsolutePath)`).
 * @module dsh-code/bootstrap/trust
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Trust-record schema version. */
export const TRUST_SCHEMA_VERSION = 1

/** The three upstream permission presets dsh-code exposes (see dsh-permission-presets). */
export const PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'] as const
export type PermissionPreset = (typeof PERMISSION_PRESETS)[number]

/** A persisted trust decision for one canonical project path. */
export interface TrustRecord {
  schemaVersion: number
  canonicalPath: string
  trustedAt: string
  lastSeenAt: string
  permissionPreset: PermissionPreset
  trustedProjectPlugins: Record<string, unknown>
}

/**
 * Canonicalize the project path so symlinked and literal spellings identify the
 * same project. The working directory always exists, so realpath resolves.
 * @param cwd - directory to canonicalize; defaults to `process.cwd()`.
 */
export function canonicalizeProjectPath(cwd: string = process.cwd()): string {
  return realpathSync(cwd)
}

/** Derive the stable, audit-safe project id from the canonical path. */
export function projectId(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath).digest('hex')
}

/** Absolute path of a project's trust record file. */
export function trustRecordPath(home: string, id: string): string {
  return join(home, 'projects', `${id}.json`)
}

/**
 * Read a trust record for a canonical path, returning `undefined` when absent
 * or unparsable (fail-closed: a corrupt record is not silently trusted).
 */
export function readTrustRecord(home: string, canonicalPath: string): TrustRecord | undefined {
  const path = trustRecordPath(home, projectId(canonicalPath))
  if (!existsSync(path)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
  const record = parsed as Partial<TrustRecord>
  if (record === null || typeof record !== 'object'
    || record.schemaVersion !== TRUST_SCHEMA_VERSION
    || record.canonicalPath !== canonicalPath
    || !PERMISSION_PRESETS.includes(record.permissionPreset as PermissionPreset)) {
    return undefined
  }
  return record as TrustRecord
}

/** Whether a canonical project path is currently trusted. */
export function isProjectTrusted(home: string, canonicalPath: string): boolean {
  return readTrustRecord(home, canonicalPath) !== undefined
}

/** Persist (or refresh) a trust record. */
export function writeTrustRecord(home: string, canonicalPath: string, preset: PermissionPreset): TrustRecord {
  const now = new Date().toISOString()
  const existing = readTrustRecord(home, canonicalPath)
  const record: TrustRecord = {
    schemaVersion: TRUST_SCHEMA_VERSION,
    canonicalPath,
    trustedAt: existing?.trustedAt ?? now,
    lastSeenAt: now,
    permissionPreset: preset,
    trustedProjectPlugins: existing?.trustedProjectPlugins ?? {},
  }
  const path = trustRecordPath(home, projectId(canonicalPath))
  mkdirSync(join(home, 'projects'), { recursive: true })
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n')
  return record
}
