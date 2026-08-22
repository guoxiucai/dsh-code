# TUI Rendering Glossary

This glossary defines the domain model used by the long-session performance work.

## Terms

### Session Event

An append-only upstream DSH event. It is the durable source of truth and is never
replaced by TUI cache state.

### Reducer State

The deterministic projection produced by replaying Session Events. It contains
the transcript, draft assistant output, phase, todos, and status data consumed by
the host.

### Transcript Item

One semantic display item: user message, assistant message, tool lifecycle card,
or notice. Existing item object identities are stable when the reducer appends an
unrelated event, which allows presentation caches to reuse their render blocks.

### Committed Transcript

The immutable prefix of completed or durable Transcript Items. Input frames and
assistant chunks must never cause this prefix to be reparsed.

### Draft Tail

The mutable reasoning/text preview for the in-flight assistant message. It may be
replaced frequently and becomes a committed assistant item when the authoritative
`assistant/message` arrives.

### Render Block

A stable presentation object for one Transcript Item. Examples are Markdown,
ReasoningBlock, and ToolCard. A Render Block may cache its output for one render
key.

### Render Key

The complete set of parameters that can change rendered lines:

```text
terminal width + theme revision + expansion mode + item revision
```

Changing any member invalidates the affected cached lines.

### Committed Line Cache

The width-specific line arrays retained by stable committed Render Blocks. They
are derived, bounded, and disposable. The Transcript Surface also retains the
last flattened `string[]`; an input-only frame returns that snapshot by reference
without traversing the committed blocks.

### Transcript Surface

The component that owns stable Render Blocks, the Committed Line Cache, and
the replaceable Draft Tail. It is the only layer allowed to translate semantic
Transcript Items into cached terminal lines.

### Viewport

The terminal rectangle currently visible inside ScrollView. Viewport clipping
controls painting; it does not by itself guarantee that off-screen content was
not rendered or measured.

### Follow End

Scroll state in which new tail lines keep the viewport pinned to the bottom.
Manual upward scrolling disables Follow End until the user explicitly returns to
the end.

### Interactive Lane

Highest-priority frame requests caused by key input, cursor movement, scrolling,
selection, or resize. These frames have a 16.7 ms P95 target at OHBM scale.

### Stream Lane

Coalesced assistant-chunk updates. The target maximum cadence is 30 FPS, and an
Interactive Lane request may preempt a waiting stream update.

### Ambient Lane

Low-frequency status work such as elapsed-time labels and token measurement. It
must not run once per assistant chunk.

### Frame Budget

The maximum main-thread time available before interaction visibly misses a
refresh deadline: 16.7 ms for 60 FPS and 33.3 ms for 30 FPS.

## Invariants

1. Session Events remain the only durable source of truth.
2. Display caches may be discarded without changing reconstructed UI semantics.
3. An input-only frame performs no work proportional to Committed Transcript
   characters or item count.
4. A draft-only update does not invalidate committed Render Block line caches.
5. Width, theme, expansion, or item changes invalidate exactly the affected
   presentation data.
6. Search, scroll, selection, copy, and Follow End observe the same logical line
   order as an uncached full render.
7. A draft is shown either as draft or committed output, never both and never
   neither.
8. Cache memory is bounded to active render parameters; old widths and themes are
   evicted.

## State Transitions

| Input | Committed revision | Draft revision | Chrome revision |
| --- | --- | --- | --- |
| `assistant/chunk` | unchanged | increment | maybe phase only |
| `assistant/message` | append/replace tail | clear | token usage may change |
| `tool/call` | append | unchanged | phase may change |
| `tool/result` | replace target item | unchanged | maybe todo/status |
| editor key | unchanged | unchanged | editor only |
| resize | render key changes | render key changes | layout changes |
| Ctrl+O | expansion key changes | expansion key changes | unchanged |
