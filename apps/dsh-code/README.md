# dsh-code

Terminal coding agent powered by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). `dsh-code` is a **thin terminal host** over `@deepseek-ai/dsh-base` — it does not reimplement the Agent Loop, Session, model adapters, tools, Sandbox, permissions, MCP, Skills, Plan/Todo, or sub-Agents. All agent semantics come from the pinned upstream DSH.

```bash
npm install -g dsh-code
cd /path/to/project
dsh-code
```

## What it is

`dsh-code` = a fixed upstream baseline + `dsh-base` + a `dsh-code` profile patch that mounts one terminal-host plugin (built on [`@earendil-works/pi-tui`](https://github.com/earendil-works/pi)) + an npm product/launcher layer.

Architectural invariants (see `docs/adr/`):

1. The TUI renders only the public `session/event` feed and public services.
2. Input flows only through `AgentHandle.followup()` / `steer()` / `cancel()` / `dispose()`.
3. No second Session Store, Provider Store, Permission Engine, or Tool Registry.
4. Single-prompt mode delegates to the upstream `headless` profile.
5. The terminal host is referenced from the profile patch by an absolute `file://` module URL — no upstream boot path is modified.

## CLI

```
dsh-code                         interactive terminal UI
dsh-code resume [session-id]     resume a persisted session
dsh-code -p <prompt>             answer one task and exit (delegates to headless)
                 [--approve]     accept project startup trust non-interactively
dsh-code plugin <add|remove|...> manage profile plugins (delegates to pnpm)
dsh-code --version | --help
```

Home isolation: `DSH_HOME = DSH_CODE_HOME ?? ~/.dsh-code`. `dsh-code` never reuses an existing `~/.dsh` home.

## Development

```bash
# from the repo root
pnpm install
pnpm -w run build:lib          # build upstream host + client lib
pnpm --filter dsh-code build   # build this package (tsc → lib/)
pnpm --filter dsh-code test    # unit + integration tests
```

The build uses plain `tsc` (not tsdown) so the TUI plugin's bare DSH imports stay
external and resolve to the same instances the upstream process loads.

## Status

Implemented and verified end-to-end (mock LLM, no real key required):

- CLI (`--help`/`--version`/error), home isolation, project trust gate, profile init.
- Launcher delegation to `@deepseek-ai/dsh/lib/bin.js`.
- Single-prompt `-p` via the upstream `headless` profile.
- TUI (`TuiMainScreen`): transcript, assistant streaming, tool cards, status bar,
  editor input, Ctrl+C cancel, Ctrl+D exit with terminal restore.
- Pure `session/event` reducer (dedup, fail-fast ordering, unknown-event policy).
- Absolute `file://` terminal-host plugin loading.

Deferred (later phases): session resume/fork, model-config wizard, approval/question
overlays, command palette, permission picker, plan/todo panels, `dsh-code update`,
npm publish/packaging, and cross-platform CI.

## Testing

- Unit: reducer (EVT-*), CLI args (CLI-*), trust (TRUST-*).
- Integration: mock-LLM closed loop (full tool round-trip + final answer), and the
  missing-credential failure path.
- A real DeepSeek / OpenAI smoke test requires a user API key (never committed).

## License

MIT. See `NOTICE` for upstream attribution.
