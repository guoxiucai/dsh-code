# dsh-code

Terminal coding agent powered by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). `dsh-code` is a **thin terminal host** over `@deepseek-ai/dsh-base` — it does not reimplement the Agent Loop, Session, model adapters, tools, Sandbox, permissions, MCP, Skills, Plan/Todo, or sub-Agents. All agent semantics come from the pinned upstream DSH.

```bash
npm install -g @tsingwill/dsh-code
cd /path/to/project
dsh-code
```

The first public release supports macOS 14+ on Apple Silicon and Windows 10+
on x64, with Node.js 22.19+ (excluding Node 23) or Node.js 24+. The npm package
uses its own `~/.dsh-code` home and does not replace or reuse a separately
installed upstream `dsh` command.

Upgrade an npm-global installation explicitly:

```bash
dsh-code update --check
dsh-code update
```

Release engineering and first-publish instructions are documented in
[`docs/NPM_RELEASE.md`](docs/NPM_RELEASE.md).

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
dsh-code -c | --continue         resume the most recent session in this directory
dsh-code -r | --resume           open the session picker (search / delete)
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
git submodule update --init --recursive   # first checkout only
pnpm install
pnpm run build:lib                        # build upstream host + client lib (inside the submodule)
pnpm run build                            # build dsh-code (tsc → lib/)
pnpm test                                 # unit + integration tests
```

Upstream `deepseek-ai/deepseek-harness` is a git submodule at `deepseek-harness/`
(pinned SHA in `UPSTREAM_BASELINE.md`). The build uses plain `tsc` (not tsdown) so
the TUI plugin's bare DSH imports stay external and resolve to the same instances
the upstream process loads.

## Status

Implemented and verified end-to-end (mock LLM, no real key required):

- CLI (`--help`/`--version`/`-p`/`-c`/`-r`/`resume`), home isolation, project trust
  gate, profile init, launcher delegation to `@deepseek-ai/dsh/lib/bin.js`.
- Absolute `file://` terminal-host plugin loading (no upstream boot path modified).
- Session lifecycle: resume by id, `-c` most-recent, `-r` full-screen picker
  (search / delete confirmation / project-scope toggle), fork, `/session` stats.
- TUI (`TuiMainScreen`): transcript, assistant streaming, tool cards, Markdown,
  diff highlighting, block backgrounds, folding, status bar, editor, keybinding
  footer, loading/retry/compaction indicators, Ctrl+C cancel, Ctrl+D exit.
- Model-config wizard, `/model` + `/permission` inline selectors, `/mcp`
  add/remove, command palette (`/model /config /mcp /session /fork /quit /exit`).
- Shell mode (`!` prefix) with bordered output.
- Approval overlay (Allow once / Reject), plan/todo/sub-agent notices.
- `/` command autocomplete, `@` file autocomplete (fd), `/permission` argument
  completions.
- Pure `session/event` reducer (dedup, fail-fast ordering, unknown-event policy).

Deferred: `dsh-code update`, npm publish/packaging (`workspace:*` → fixed
versions), and cross-platform CI.

## Testing

- Unit: reducer (EVT-*), CLI args (CLI-*), trust (TRUST-*).
- Integration: mock-LLM closed loop (full tool round-trip + final answer), and the
  missing-credential failure path.
- A real DeepSeek / OpenAI smoke test requires a user API key (never committed).

## License

MIT. See `NOTICE` for upstream attribution.
