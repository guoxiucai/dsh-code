# Changelog

## 0.1.0 — unreleased

Initial thin-terminal-host implementation over the pinned upstream DSH baseline
(`47f943859bef60e4160492346772ded9b24f765a`, `0.1.0-rc.5`).

- Launcher: product verbs, home isolation (`DSH_CODE_HOME`), project trust gate,
  fixed profile init, delegation to `@deepseek-ai/dsh/lib/bin.js`.
- Single-prompt `-p` via the upstream `headless` profile.
- Terminal UI (`pi-tui` `TuiMainScreen`): transcript, streaming, tool cards,
  status bar, editor, cancel/exit with terminal restore.
- Pure `session/event` reducer with seq dedup, fail-fast ordering, and
  unknown-event policy.
