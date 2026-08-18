# ADR-002: Launcher Delegation

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

`dsh-code` must not reimplement DSH's boot, shutdown, profile reconciliation, or
plugin-loading logic. The upstream `@deepseek-ai/dsh` CLI already owns these: it
parses `--profile <name>`, composes the profile's patch layers, boots the Cordis
tree, and hands inner args to the tree through `ctx.cmdlineArgs`.

## Decision

`dsh-code` delegates profile boot to the upstream launcher:

1. Resolve `@deepseek-ai/dsh/lib/bin.js` from the installed dependencies.
2. Spawn it with the current `process.execPath`, inheriting stdin/stdout/stderr.
3. Pass a fixed `--profile dsh-code` plus the invocation's inner app args.
4. Wait for the upstream process to dispose, then exit with the same code.

`dsh-code`'s own launcher owns only: argv parsing for its product verbs, the
`DSH_CODE_HOME` home isolation (`DSH_HOME = DSH_CODE_HOME ?? ~/.dsh-code`), project
trust, profile initialization, and the single-prompt `-p` delegation to the
`headless` profile.

The `dsh-code` TUI plugin is referenced from the profile patch by an **absolute
`file://` ESM module URL** into the installed `dsh-code` package, so no upstream
boot path is modified.

## Consequences

- Upstream launcher flags precede app args (`dsh-code --profile ...` shape is
  reserved for delegation only; product verbs are parsed first).
- The profile bootstrap files live under `~/.dsh-code/profiles/dsh-code/`.
- If upstream changes its bin path or boot contract, the delegation shim is the
  only surface that adapts.
