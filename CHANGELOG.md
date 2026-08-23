# Changelog

## 0.1.1-rc.1 — 2026-08-23

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
- Made the upstream `standard` Agent Preset the explicit dsh-code default for
  new and resumed TUI sessions; mode switching remains intentionally absent.
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
