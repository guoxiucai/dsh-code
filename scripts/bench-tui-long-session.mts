/**
 * Reproduce long-session TUI latency without starting an interactive terminal.
 *
 * The benchmark replays a real persisted Session through the production reducer,
 * then drives the production host/layout path. It prints aggregate sizes and
 * timings only; message contents never leave this process.
 */

import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { zstdDecompressSync } from 'node:zlib'
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import type { Component, Editor } from '@earendil-works/pi-tui'
import { decodeStorageRecord, type SessionEvent } from '@deepseek-ai/dsh-session'
import { TuiHost } from '../src/tui/host.ts'
import { createReducerState, reduceSessionEvent, type ReducerState } from '../src/tui/reducer.ts'

const ZSTD_MAGIC = 0xFD2FB528
const FRAME_BUDGET_MS = 1000 / 60
const STREAM_BUDGET_MS = 1000 / 30
const WIDTH = 120
const HEIGHT = 40

interface FrameRange { start: number; end: number }

function scanZstdFrames(buffer: Buffer): FrameRange[] {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 5 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    const descriptor = buffer.readUInt8(offset++)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    let complete = false
    while (buffer.length - offset >= 3) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) break
      offset += payloadBytes
      if (lastBlock) { complete = true; break }
    }
    if (!complete || (checksum && buffer.length - offset < 4)) break
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return frames
}

function readSession(path: string): { decodedBytes: number; events: SessionEvent[] } {
  const raw = readFileSync(path)
  const text = path.endsWith('.zstd')
    ? scanZstdFrames(raw)
      .map(({ start, end }) => zstdDecompressSync(raw.subarray(start, end)).toString('utf8'))
      .join('')
    : raw.toString('utf8')
  const records = text.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return {
    decodedBytes: Buffer.byteLength(text),
    events: records.slice(1).flatMap(record => decodeStorageRecord(record)),
  }
}

function replay(events: readonly SessionEvent[]): ReducerState {
  let state = createReducerState('benchmark')
  for (const event of events) state = reduceSessionEvent(state, event)
  return state
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
}

function measure(iterations: number, operation: () => void): { p50Ms: number; p95Ms: number; maxMs: number } {
  const samples: number[] = []
  operation()
  for (let index = 0; index < iterations; index++) {
    const start = performance.now()
    operation()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return {
    p50Ms: percentile(samples, 0.50),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples.at(-1) ?? 0,
  }
}

function roundTimings(value: { p50Ms: number; p95Ms: number; maxMs: number }): Record<string, number> {
  return Object.fromEntries(Object.entries(value).map(([key, number]) => [key, Number(number.toFixed(2))]))
}

function createHost(): {
  host: TuiHost
  editor: Editor
  frame(): void
} {
  const host = new TuiHost({
    onSubmit: () => {},
    onInterrupt: () => {},
    onExit: () => {},
    onRedraw: () => {},
    onEditorChange: text => { host.setShellMode(text.trimStart().startsWith('!')) },
  })
  const editor = (host as unknown as { editor: Editor }).editor
  const root = (host.tui as unknown as { layoutRoot: Component }).layoutRoot
  return {
    host,
    editor,
    frame: () => { renderLayoutFrame(root, WIDTH, HEIGHT, () => {}) },
  }
}

function characterBreakdown(state: ReducerState): Record<string, number> {
  const counts = { user: 0, assistant: 0, reasoning: 0, notice: 0, toolArguments: 0, toolResults: 0 }
  for (const item of state.transcript) {
    if (item.kind === 'user') counts.user += item.text.length
    else if (item.kind === 'notice') counts.notice += item.text.length
    else if (item.kind === 'assistant') {
      counts.assistant += item.text.length
      counts.reasoning += item.reasoning?.length ?? 0
    } else {
      counts.toolArguments += item.arguments.length
      counts.toolResults += item.resultText?.length ?? 0
    }
  }
  return counts
}

function totalCharacters(state: ReducerState): number {
  return Object.values(characterBreakdown(state)).reduce((sum, value) => sum + value, 0)
}

const path = process.argv[2]
if (path === undefined) {
  process.stderr.write('usage: pnpm exec tsx scripts/bench-tui-long-session.mts <session.jsonl.zstd>\n')
  process.exit(2)
}

const { decodedBytes, events } = readSession(path)
const state = replay(events)
const full = createHost()
full.host.render({ ...state, phase: 'idle', turnStartedAt: undefined })

const steadyFrame = measure(40, full.frame)
const inputLatency: Record<string, Record<string, number>> = {}
const isolatedInputLatency: Record<string, Record<string, number>> = {}
const empty = createHost()
empty.host.render({ ...createReducerState('empty'), phase: 'idle', turnStartedAt: undefined })
for (const inputCharacters of [0, 1_000, 10_000, 50_000]) {
  full.editor.setText('字'.repeat(inputCharacters))
  inputLatency[String(inputCharacters)] = roundTimings(measure(20, () => {
    full.editor.handleInput('x')
    full.frame()
  }))
  empty.editor.setText('字'.repeat(inputCharacters))
  isolatedInputLatency[String(inputCharacters)] = roundTimings(measure(20, () => {
    empty.editor.handleInput('x')
    empty.frame()
  }))
}

// Keep the rebuild measurement independent from the preceding large-input case.
full.editor.setText('')
const redundantUpdateAndFrame = measure(20, () => {
  full.host.render({ ...state, phase: 'idle', turnStartedAt: undefined })
  full.frame()
})

const stream = createHost()
const idleState = { ...state, phase: 'idle' as const, turnStartedAt: undefined }
stream.host.render(idleState)
stream.frame()
let streamText = ''
let streamReasoning = ''
const streamDraftAndFrame = measure(30, () => {
  streamText += ' streaming **markdown** with `code` and 中文。'.repeat(4)
  streamReasoning += ' incremental reasoning 中文。'.repeat(4)
  stream.host.setDraft({ text: streamText, reasoning: streamReasoning })
  stream.host.render(idleState)
  stream.frame()
})

const changedTail = createHost()
changedTail.host.render(idleState)
changedTail.frame()
let tailRevision = 0
const replaceTailItemAndFrame = measure(20, () => {
  tailRevision += 1
  changedTail.host.render({
    ...idleState,
    transcript: [...state.transcript, {
      kind: 'assistant',
      text: `tail-${tailRevision} ` + 'completed **markdown** 中文。'.repeat(40),
      reasoning: 'completed reasoning 中文。'.repeat(20),
    }],
  })
  changedTail.frame()
})

const initialFullHistoryFrame = measure(5, () => {
  const initial = createHost()
  initial.host.render(idleState)
  initial.frame()
})

const tenX = createHost()
const tenXState = {
  ...idleState,
  transcript: Array.from({ length: 10 }, () => state.transcript).flat(),
}
tenX.host.render(tenXState)
tenX.frame()
const tenXSteadyFrame = measure(20, tenX.frame)
tenX.editor.setText('字'.repeat(10_000))
const tenXInputAndFrame = measure(20, () => {
  tenX.editor.handleInput('x')
  tenX.frame()
})
tenX.editor.setText('')
let tenXDraft = ''
const tenXStreamDraftAndFrame = measure(20, () => {
  tenXDraft += ' streaming **markdown** with 中文。'.repeat(4)
  tenX.host.setDraft({ text: tenXDraft, reasoning: '' })
  tenX.host.render(tenXState)
  tenX.frame()
})

const withoutReasoning = createHost()
const withoutReasoningState = {
  ...state,
  transcript: state.transcript.map(item => item.kind === 'assistant' ? { ...item, reasoning: undefined } : item),
  phase: 'idle' as const,
  turnStartedAt: undefined,
}
withoutReasoning.host.render(withoutReasoningState)
const steadyWithoutReasoning = measure(30, withoutReasoning.frame)
const rebuildWithoutReasoning = measure(20, () => {
  withoutReasoning.host.render(withoutReasoningState)
  withoutReasoning.frame()
})

const recentResults: Record<string, unknown> = {}
for (const itemCount of [10, 25, 50]) {
  const recent = createHost()
  const recentState = { ...state, transcript: state.transcript.slice(-itemCount), phase: 'idle' as const, turnStartedAt: undefined }
  recentResults[String(itemCount)] = {
    characters: totalCharacters(recentState),
    timings: roundTimings(measure(20, () => {
      recent.host.render(recentState)
      recent.frame()
    })),
  }
}

const result = {
  verdict: steadyFrame.p95Ms > FRAME_BUDGET_MS
    || (inputLatency['10000']?.p95Ms ?? 0) > FRAME_BUDGET_MS
    || streamDraftAndFrame.p95Ms > STREAM_BUDGET_MS
    || replaceTailItemAndFrame.p95Ms > STREAM_BUDGET_MS
    || tenXInputAndFrame.p95Ms > STREAM_BUDGET_MS
    || tenXStreamDraftAndFrame.p95Ms > STREAM_BUDGET_MS
    ? 'RED: long-session interaction exceeds an interactive/stream frame budget'
    : 'GREEN: measured paths stay within their interactive/stream frame budgets',
  frameBudgetMs: Number(FRAME_BUDGET_MS.toFixed(2)),
  streamBudgetMs: Number(STREAM_BUDGET_MS.toFixed(2)),
  fixture: {
    compressedBytes: readFileSync(path).byteLength,
    decodedBytes,
    events: events.length,
    transcriptItems: state.transcript.length,
    transcriptCharacters: totalCharacters(state),
    charactersByKind: characterBreakdown(state),
  },
  timings: {
    steadyFullHistoryFrame: roundTimings(steadyFrame),
    redundantFullViewUpdateAndFrame: roundTimings(redundantUpdateAndFrame),
    streamDraftAndFrame: roundTimings(streamDraftAndFrame),
    replaceTailItemAndFrame: roundTimings(replaceTailItemAndFrame),
    initialFullHistoryFrame: roundTimings(initialFullHistoryFrame),
    tenXHistory: {
      transcriptItems: tenXState.transcript.length,
      steadyFrame: roundTimings(tenXSteadyFrame),
      input10kAndFrame: roundTimings(tenXInputAndFrame),
      streamDraftAndFrame: roundTimings(tenXStreamDraftAndFrame),
    },
    steadyWithoutReasoning: roundTimings(steadyWithoutReasoning),
    rebuildWithoutReasoningAndFrame: roundTimings(rebuildWithoutReasoning),
    rebuildRecentItemsAndFrame: recentResults,
    inputKeyAndFrameByCharacters: inputLatency,
    isolatedInputKeyAndFrameByCharacters: isolatedInputLatency,
  },
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exit(result.verdict.startsWith('RED') ? 1 : 0)
