# ADR-003: Incremental Cached Transcript Rendering

- **Status:** Accepted
- **Date:** 2026-08-22
- **Implemented:** 2026-08-23

## Context

The terminal host currently clears and reconstructs every transcript component in
`TuiHost.render()`. pi-tui's `ScrollView` clips painting to the viewport, but it
still asks its child for the complete rendered line array to measure content
height. Input frames therefore revisit committed history, while stream frames
also discard component-local Markdown caches.

The OHBM long-session benchmark contains 149 visible items and 284,871 transcript
characters. Its P95 steady frame is 76.09 ms and its P95 rebuild-plus-layout is
99.90 ms at 120×40, both well above the 16.7 ms interactive frame budget.

ADR-001 requires the TUI to remain a projection of public Session events. Any
optimization must not create another Session store or alter Agent semantics.

## Decision

The terminal host will use an **incremental cached transcript surface**:

1. Committed `TranscriptItem` objects map to stable render blocks. An unchanged
   item reuses its block across Session events and input frames.
2. The surface retains one flattened line snapshot for the current terminal
   width, theme revision, and expansion mode. A valid snapshot is returned by
   reference instead of being reconstructed per frame.
3. The committed prefix and the in-flight assistant draft have independent
   revisions. A draft chunk may replace only the tail and must not invalidate
   committed history.
4. Collapsed reasoning, tool output, diffs, and parsed tool arguments are derived
   once per stable item. Collapsed rendering must not scan hidden full content on
   every frame.
5. Rendering is split into interactive, stream, and ambient lanes. Interactive
   input may preempt stream coalescing; token-meter and elapsed-time chrome are
   kept out of the per-chunk hot path.
6. Cache state is presentation-only, bounded to active render parameters, and
   disposable. The upstream Session, reducer, AgentHandle, search, selection,
   scrolling, and shutdown contracts remain authoritative.

True virtual line fetching is deferred. If cached line snapshots do not meet the
10× OHBM target, the required line-source abstraction should be contributed to
pi-tui rather than implemented as a private replacement ScrollView.

## Validation

After implementation, the same OHBM benchmark reports a 0.13 ms P95 steady
frame, 5.12 ms P95 with a 10k-character editor, and 3.91 ms P95 while updating a
streaming draft. A 10× transcript reports 5.33 ms P95 for 10k input and 1.57 ms
P95 for draft streaming. The original red-capable command now returns GREEN.

## Consequences

- Ordinary input work becomes independent of committed history size.
- Stream updates pay for the changing draft and visible chrome, not old Markdown.
- Resize, theme changes, and global expansion may still require an intentional
  one-time full rebuild.
- The host owns more derived presentation state and needs explicit invalidation
  tests.
- Cached rendered lines consume additional memory, bounded to the active width
  and mode.
- No persisted format or upstream Agent behavior changes.

## Rejected Alternatives

- **Throttle all frames:** reduces stream frequency but leaves input frames
  O(history).
- **Truncate old messages:** breaks full-history scrolling, search, and copying.
- **Rewrite the editor first:** isolated 10k-character input remains within the
  frame budget; transcript work dominates the observed session.
- **Fork Session or reducer semantics:** violates ADR-001 and creates an
  unnecessary second source of truth.
- **Replace pi-tui immediately:** the first optimization can be expressed through
  its public Component contract; replacement cost is not yet justified.
