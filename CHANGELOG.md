# Changelog

## 0.1.2 — Unreleased

- Updated the pinned DeepSeek Harness runtime from `0.1.1-rc.2`
  (`b150a551b8`) to `0.1.2-alpha.2` (`0a53fb55be`).
- Adapted the terminal host to the renamed `ptc` preset, session preset
  projections, event-based user-question provider, subagent model settings, and
  the upstream `ToolCallId`/Todo event type declarations.
- Adopted the `0.1.2-alpha.2` literal settings namespace API and Session-based
  permission preset projection.
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
