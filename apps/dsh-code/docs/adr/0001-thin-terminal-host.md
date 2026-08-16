# ADR-001: Thin Terminal Host

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

`dsh-code` is a terminal coding agent product. DeepSeek Harness (DSH) already owns
the Agent Loop, Session, model adapters, tools, Sandbox, permission engine, MCP,
Skills, Plan/Todo, and sub-Agent semantics. Reimplementing any of that would fork
the core and make upstream merges expensive.

## Decision

`dsh-code` is a **thin Terminal Host**: `dsh-base` (upstream bundle) plus a
`dsh-code` profile patch that mounts a single terminal-facing plugin. All agent
semantics come from the pinned upstream DSH.

Hard invariants:

1. The TUI only consumes the public `session/event` feed and public services
   (`ctx.agents`, `ctx.approval`, `ctx.permissionPresets`, `ctx.commands`,
   `ctx.sessions`, `ctx.sessionQuery`, `ctx.userQuestions`).
2. User input is only driven back through `AgentHandle.followup()` / `steer()` /
   `cancel()`; teardown through `dispose()`.
3. No second Session Store, Provider Store, Permission Engine, or Tool Registry.
4. No import of `agent-loop` internals; no guesswork from text — the TUI renders
   structured events only.
5. Exit flushes through upstream dispose before the process exits.

## Consequences

- Product differences are confined to terminal presentation, launcher/startup,
  project trust, and npm distribution.
- Missing generic non-UI capability is contributed upstream first, then enabled on
  a new baseline (see ADR-002).
