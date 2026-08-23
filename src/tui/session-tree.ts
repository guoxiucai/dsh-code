/** Pure projection from DSH session records to the project-local branch tree. */

import type { SessionRecord } from '@deepseek-ai/dsh-session-query'

export interface SessionTreeRow {
  id: string
  parentId: string | undefined
  title: string
  createdAt: number
  depth: number
  /** For each ancestor depth, whether a vertical continuation is visible. */
  guides: boolean[]
  lastSibling: boolean
  current: boolean
  activePath: boolean
  hasChildren: boolean
  live: boolean
  persisted: boolean
}

interface MutableNode {
  record: SessionRecord
  children: MutableNode[]
}

/** Build the complete connected lineage containing `currentId`. */
export function buildSessionTreeRows(
  records: readonly SessionRecord[],
  currentId: string,
  titles: ReadonlyMap<string, string> = new Map(),
): SessionTreeRow[] {
  const eligible = records.filter(record => record.header.origin !== 'subagent')
  const byId = new Map(eligible.map(record => [String(record.header.id), record]))
  const current = byId.get(currentId)
  if (current === undefined) return []

  const activePath = new Set<string>()
  let cursor: SessionRecord | undefined = current
  while (cursor !== undefined) {
    const id = String(cursor.header.id)
    if (activePath.has(id)) break
    activePath.add(id)
    const parentId: string | undefined = cursor.header.parentSession
    const parentRecord: SessionRecord | undefined = parentId === undefined ? undefined : byId.get(String(parentId))
    cursor = parentRecord
  }

  let root = current
  const seen = new Set<string>()
  while (root.header.parentSession !== undefined) {
    const id = String(root.header.id)
    if (seen.has(id)) break
    seen.add(id)
    const parent = byId.get(String(root.header.parentSession))
    if (parent === undefined) break
    root = parent
  }

  const nodes = new Map<string, MutableNode>()
  for (const record of eligible) nodes.set(String(record.header.id), { record, children: [] })
  for (const node of nodes.values()) {
    const parentId = node.record.header.parentSession
    if (parentId !== undefined) nodes.get(String(parentId))?.children.push(node)
  }
  for (const node of nodes.values()) {
    node.children.sort((left, right) => {
      const leftActive = activePath.has(String(left.record.header.id)) ? 0 : 1
      const rightActive = activePath.has(String(right.record.header.id)) ? 0 : 1
      return leftActive - rightActive
        || left.record.header.createdAt - right.record.header.createdAt
        || String(left.record.header.id).localeCompare(String(right.record.header.id))
    })
  }

  const rootNode = nodes.get(String(root.header.id))
  if (rootNode === undefined) return []
  const rows: SessionTreeRow[] = []
  const stack: Array<{ node: MutableNode; depth: number; guides: boolean[]; lastSibling: boolean }> = [
    { node: rootNode, depth: 0, guides: [], lastSibling: true },
  ]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const entry = stack.pop()
    if (entry === undefined) break
    const id = String(entry.node.record.header.id)
    if (visited.has(id)) continue
    visited.add(id)
    const fallback = id.length > 20 ? `${id.slice(0, 17)}…` : id
    rows.push({
      id,
      parentId: entry.node.record.header.parentSession === undefined
        ? undefined
        : String(entry.node.record.header.parentSession),
      title: titles.get(id)?.trim() || fallback,
      createdAt: entry.node.record.header.createdAt,
      depth: entry.depth,
      guides: entry.guides,
      lastSibling: entry.lastSibling,
      current: id === currentId,
      activePath: activePath.has(id),
      hasChildren: entry.node.children.length > 0,
      live: entry.node.record.live,
      persisted: entry.node.record.persisted,
    })
    for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      const child = entry.node.children[index]
      if (child === undefined) continue
      stack.push({
        node: child,
        depth: entry.depth + 1,
        guides: entry.depth === 0 ? [] : [...entry.guides, !entry.lastSibling],
        lastSibling: index === entry.node.children.length - 1,
      })
    }
  }
  return rows
}

/** Explain why a live session cannot safely be handed to another process yet. */
export function sessionSwitchBlocker(input: {
  agentRunning: boolean
  queuedMessages: number
  liveJobs: number
  activeSubagents: number
}): string | undefined {
  if (input.agentRunning) return 'interrupt the active turn before switching sessions (Esc)'
  if (input.queuedMessages > 0) return 'wait for queued messages to finish before switching sessions'
  if (input.activeSubagents > 0) return 'wait for or cancel active subagents before switching sessions'
  if (input.liveJobs > 0) return 'stop active background jobs before switching sessions'
  return undefined
}
