# Changelog

## 0.2.0 — Unreleased

- Upgrade DeepSeek Harness from `0.1.7-rc.2` through `0.2.0-rc.1` to
  `0.2.0-rc.2` (`639ed01539`), with pi-ai `0.87.1` and its upstream workspace patch.
- Display recovery failures for assistant tool requests that never reached a
  recorded call start; keep unknown outcomes distinct from successful execution.
  Live rendering and replay use the same recorded results without invented timing.
- Keep Standard/PTC's default blocking questions; upstream timed questions remain
  opt-in. Session storage stays at v4 and the legacy shell-first limitation remains.
- Include upstream failed-step recovery, Windows permission diagnosis, shell
  completion, and Web improvements. Schedule now belongs to an optional bundle;
  existing Web users who enabled its former rows must enable that bundle.

## 0.1.7 — 2026-09-30

- Upgrade DeepSeek Harness from `0.1.6-alpha.2` through the 0.1.7 alpha/RC
  stages to `0.1.7-rc.2` (`477b4f4205`).
- Adopt the upstream declarative Standard/PTC presets and profile-backed model
  settings; preserve saved settings and user plugins when refreshing the TUI profile.
- Support Session v4 listings, migrated user-shell context, native tool-role
  results, producer-owned notices, and dynamic tool-update events during replay.
- Update background-job controls to Session IDs and inspect output without
  consuming the model's output cursor. Use approval presentation reasons when supplied.
- Persist shell observations in the Agent inbox before model admission, keeping
  shell-only sessions resumable and preserving executed results across cancellation.
  Legacy logs with shell context before the first system prompt require separate
  migration repair; refuse continuation without rewriting their history.
- Align workspace dependency patches with upstream, including pi-ai streaming
  and spreadsheet previews. These pnpm patches apply to workspace builds.

## 0.1.6 — 2026-09-29

- Support Linux x64 alongside macOS arm64 and Windows x64, including Linux
  clipboard copy/paste. Add Ubuntu Node 22/24 clean-install release checks.
- Accept upstream image-offload events during live updates and session replay.

- Save `!` shell results as durable model context and restore their terminal
  cards on resume; keep `!!` output terminal-only. Preserve shell-only sessions.
- Let Esc cancel from live Agent state before the first output or render,
  including queued work and user shell execution.

- Upgrade DeepSeek Harness to `0.1.6-alpha.2` (`ddefc45fbc`).
- Use the upstream base's shared Node-process PTC runtime instead of the
  removed worker-thread provider; update runtime smoke checks to resolve
  execution requests before running them.
- Record Linux validation boundaries and an Ubuntu npm-install test guide.

## 0.1.5 — 2026-09-19

- Upgrade DeepSeek Harness through `0.1.5-alpha.1` and `0.1.5-alpha.2` to
  `0.1.5-rc.2` (`fb2c4b9e69`).
- Include upstream Web feedback-dialog and delivered-file presentation fixes.
- Support Session v3 listings and migrated PTC dispatch events; accept system,
  subagent catalog, and deliverable events during transcript replay.
- Use the explicit Agent setup parameter to restore session presets.
- Build the upstream native system addon for local Session write locks.
- Require `js-yaml >=4.3.2` to address GHSA-2883-xcg3-v3hh.

### Included changes from the unpublished 0.1.3 development version

- Upgrade DeepSeek Harness to `0.1.3-alpha.2` (`82a5fd61a7`).
- Accept upstream message-feedback audit events when replaying Web sessions.
- Align `pi-ai` to `0.85.1` and include the new upstream benchmark workspace
  required by the Host build.
- Read the newest canonical Session generation in resume lists, preserving
  fork lineage and refusing fallback to stale predecessor logs.
- Consume process-local assistant stream frames for live TUI drafts; keep
  durable v2 attempt settlement separate from Session event sequencing.
- Persist fork/clone children through explicit storage handles and release
  write ownership before switching; preserve unreadable/non-text sessions
  during Web empty-session cleanup.
- Enable the upstream `fs-ext` native build for cross-process Session leases.

## 0.1.2 — 2026-09-07

- Kept direct `!` shell results at their position in the transcript so later
  replies flow below them. Normal TUI exits now print the transcript to terminal
  scrollback with rendered colors and formatting, without input/status controls,
  and end with a session resume command.
  Session handoffs stay silent, and discarded empty sessions have no resume hint.

- Updated the pinned DeepSeek Harness runtime from `0.1.1-rc.2`
  (`b150a551b8`) to `0.1.2-rc.1` (`a66e470204`).
- Adapted the terminal host to the renamed `ptc` preset, session preset
  projections, event-based user-question provider, subagent model settings, and
  the upstream `ToolCallId`/Todo event type declarations.
- Adopted the `0.1.2-alpha.2` literal settings namespace API and Session-based
  permission preset projection.
- Adopted the `0.1.2-alpha.3` JSONL-only Session persistence closure and Web
  blank-session, connection, paging, and streaming fixes without adding a
  downstream compatibility layer.
- Adopted the `0.1.2-alpha.4` branded Session sequence/offset API and immutable
  event snapshots, preserving fork lineage through `inheritedEventCount` and
  `isSeeded` while keeping the version-0 JSONL wire format compatible.
- Adopted the `0.1.2-alpha.5` storage read-compatibility and per-record salvage
  runtime. The Session projection cache can now reuse compatible older records
  and back up malformed derived records instead of preventing startup; no
  downstream Session, Agent, command, or Web API adaptation was required.
- Promoted the upstream runtime to `0.1.2-rc.1`; this release only changes DSH
  workspace package versions from `0.1.2-alpha.5` and introduces no additional
  source or interface changes.
- Added a root Lefthook development gate: staged whitespace and related tests
  run before commits, while type checking and the full test suite run before
  pushes.
- Preserved resume compatibility for sessions that recorded the former `code`
  PTC preset id.
- Reworked interactive session commands around DSH's linear-session primitives:
  added `/new`, `/resume`, and `/clone`; changed `/fork` to select a historical
  user request, copy the prefix before its turn, and switch to the child; and
  removed the misleading `/tree` entry-tree substitute.
- Made `/new` always enter Standard mode, discard a newly created Session when
  it exits without any human message, and render fork/clone ancestry as nested
  generations in the `/resume` picker.
- Added `/web`: after the current TUI flushes and exits, the launcher starts the
  package-local upstream DSH Web profile with the same isolated home and trusted
  project patch, parks the terminal in a read-only lifecycle screen, and resumes
  the original Session from disk after Web stops. Blank fresh Sessions retain
  their existing no-message cleanup semantics across the handoff.
- Kept all downstream adaptations in dsh-code; the upstream submodule source is
  unchanged.

## 0.1.1 — 2026-08-23

- Updated the pinned DeepSeek Harness runtime from `0.1.0-rc.7`
  (`99f6f02fec`) to `0.1.1-rc.2` (`b150a551b8`).
- Adapted slash-command dispatch to the upstream explicit attachment-admission
  contract while preserving dsh-code's current text-only TUI submission path.
- Fixed first-run detection after DSH migrates saved credentials into its
  versioned `refs`/`records` document, preventing onboarding from reopening on resume.
- Kept replay compatible with the new upstream Agent Team audit events.
- Added inline `/goal`, `/skills`, `/agents`, `/mcp`, `/rename`, `/jobs`, and
  `/export` workflows, including dsh-code-only Skill preferences and grouped
  external MCP discovery.
- Changed `/mcp` to show only dsh-code-owned user/project servers by default;
  external Claude Code, Codex, and standalone DSH configs are scanned only by
  the explicit import action. Imported copies are independent, can be enabled
  or disabled in place, and hot-connect through the public upstream MCP plugin
  without restarting dsh-code.
- Isolated noisy stdio MCP server stderr from the alternate-screen TUI through
  a transparent cross-platform proxy; diagnostics now rotate under
  `~/.dsh-code/logs/mcp/` instead of corrupting the bottom-pinned layout.
- Added Standard/PTC session modes while keeping `standard` as the default:
  `--mode` selects a fresh session, `/mode` can recompose only before the first
  turn, and resume reconstructs the preset recorded in the session log.
- Mounted the worker-thread Code Runtime for PTC and rendered its durable child
  calls as native, five-line-collapsed tool rows while keeping file diffs fully
  expanded across live output and replay.
- Prevented the first PTC execution from writing Node's type-strip
  `ExperimentalWarning` through the alternate-screen TUI. The compatibility
  preload matches only that warning, preserves all other process warnings, and
  the installed-package smoke now executes a typed PTC program to guard it.
- Added a searchable, collapsible `/tree` session-lineage picker. Switching is
  handed back to the launcher only after the old TUI flushes and exits, and is
  blocked while turns, queued messages, sub-agents, or background jobs are live.
  `/fork` keeps its existing create-only behavior and now points users to `/tree`.
- Made long-session transcript rendering incremental and cached, reducing the
  OHBM benchmark's steady-frame P95 from 76.09 ms to 0.13 ms while keeping
  committed history selectable and searchable.
- Added themed large-paste markers, fuzzy `@` completion for files and folders,
  and visible queued-message feedback when users submit during an active turn.
- Added an independent clickable active-subagent indicator below `Working`, an
  inline `/agents` list with live status and cancel/remove actions, and automatic
  reporting/removal when work settles.
- Hid `origin: subagent` child sessions from launcher resume/continue lists;
  subagents remain visible and manageable only from their main session.
- Limited verbose tool arguments/results to five terminal-width-aware visual
  rows by default while keeping file-edit diffs fully expanded for review.
- Fixed clean CI builds by bridging the parent workspace's installed type
  definitions into the upstream client's explicit type-root location.

## 0.1.0 — 2026-08-20

Thin-terminal-host implementation over the pinned upstream DSH baseline
(`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`, `0.1.0-rc.7`).

### Launcher & packaging

- Product verbs (`--help`/`--version`/`-p`/`-c`/`-r`/`resume`/`plugin`), home
  isolation (`DSH_CODE_HOME`), project trust gate, fixed profile init, and
  delegation to `@deepseek-ai/dsh/lib/bin.js`.
- Single-prompt `-p` via the upstream `headless` profile.
- Absolute `file://` terminal-host plugin loading (no upstream boot path modified).
- Scoped npm release staging for `@tsingwill/dsh-code`, exact runtime dependency
  shrinkwrap, package audit, macOS/Windows smoke installation, and protected
  trusted-publishing workflow.
- Explicit `dsh-code update` checks and upgrades for npm-global installations.
- Runtime platform guard for macOS arm64 and Windows 10+ x64.
- English/Chinese product documentation, terminal-whale SVG logo, and packaged
  README media assets.

### Session lifecycle

- Resume by id (`resume <id>`), most-recent session (`-c`/`--continue`), and a
  full-screen picker (`-r`/`--resume`) with search, delete confirmation, and
  project-scope toggle.
- Forking at the last completed turn with stable UUID ids.
- `/session` stats (message counts + token usage with cache read/write split and
  reasoning tokens).

### Terminal UI

- `pi-tui` `TuiMainScreen`: transcript, assistant streaming, tool cards, status
  bar, editor, cancel/exit with terminal restore.
- Markdown rendering, tool-result diff highlighting, reasoning/tool-result
  folding (Ctrl+O), full-width block backgrounds, keybinding footer.
- loading / retry / compaction status indicators.
- Command palette (`/model /config /mcp /session /fork /quit /exit`).
- Inline selectors for `/model` and `/permission` (search + keyboard navigation).
- Shell mode (`!` prefix) with bordered output.
- `/` command autocomplete, `@` file autocomplete (fd), `/permission` argument
  completions.

### Agent integration

- Bottom-pinned one-shot approval bar (Allow once / Reject) for sandbox
  escalation and hook-driven asks.
- Structured `ask_user_question` and plan-review panels with single choice,
  multi-select, custom answers, bounded Markdown, cancellation, and serialized
  concurrent requests.
- Reversible inline model configuration wizard for DeepSeek, OpenAI, and
  five-field OpenAI-compatible routes.
- MCP server configuration (add/remove stdio + Streamable HTTP servers).
- Dedicated completed/active/pending Todo panel plus plan and sub-agent status.

### Internals

- Pure `session/event` reducer with seq dedup, fail-fast ordering, and
  unknown-event policy.
