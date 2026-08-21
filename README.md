<p align="center">
  <img src="docs/assets/dsh-code-logo.svg" width="168" alt="dsh-code terminal whale logo">
</p>

<h1 align="center">dsh-code</h1>

<p align="center">
  A DeepSeek Harness terminal coding agent for developers who prefer a focused TUI workflow.
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/guoxiucai/dsh-code/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/guoxiucai/dsh-code/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4D6BFE.svg"></a>
  <img alt="Node.js 22.19 or 24" src="https://img.shields.io/badge/Node.js-22.19%2B%20%7C%2024%2B-43853D.svg">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="Powered by dsh" src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white"></a>
</p>

> [!IMPORTANT]
> `dsh-code` is an independent community project, not an official DeepSeek
> distribution. DeepSeek Harness is also in developer preview, so
> compatibility-breaking upstream changes may occur between pinned baselines.

## Why dsh-code?

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) provides an
official Web UI and a plugin-first agent runtime. `dsh-code` is for developers
who prefer to stay in the terminal: it packages the same DSH agent semantics in
a compact, keyboard-driven interface that works naturally beside shells,
editors, Git, and remote development environments.

The product draws on the interaction ideas of
[Pi](https://github.com/earendil-works/pi) and uses
[`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui)
for terminal rendering. It does **not** fork or replace the agent core. The Agent
Loop, sessions, model adapters, tools, sandbox, permissions, MCP, Skills,
Plan/Todo, and sub-agents remain owned by the pinned DSH runtime.

In short:

```text
DeepSeek Harness agent runtime + Pi-inspired terminal UX + pi-tui renderer
```

## Preview

<p align="center">
  <img src="docs/assets/demo1.png" width="920" alt="dsh-code welcome screen and command autocomplete">
</p>

## Highlights

- **Terminal-native workflow** — streaming Markdown, a five-line live reasoning
  window, line-numbered file diffs, selectable/copyable results, shell blocks,
  and a bottom-pinned composer.
- **DeepSeek Harness semantics** — uses DSH's public session/events and services;
  there is no second agent loop, session store, permission engine, or tool registry.
- **Model setup in the TUI** — configure DeepSeek, OpenAI, or an
  OpenAI-compatible endpoint through an inline, reversible wizard.
- **Safe project startup** — canonical-path trust records and `read-only`,
  `workspace-write`, or `danger-full-access` permission presets.
- **Persistent sessions** — continue the latest session, search/resume/delete
  history, inspect session statistics, fork a completed turn, and compact context.
- **Agent visibility** — dedicated Plan/Todo states, tool progress, retry and
  compaction indicators, approval prompts, and sub-agent activity.
- **Fast terminal controls** — slash-command completion, `@` file completion,
  direct `!` shell mode, inline selectors, and keyboard-first navigation.
- **Independent installation** — stores product data under `~/.dsh-code`, keeps
  a separately installed `dsh` command untouched, and supports explicit updates.
- **Adaptive visuals** — a DeepSeek-blue palette tuned independently for dark
  and light terminal backgrounds.

## Architecture

`dsh-code` is deliberately a thin terminal host over a fixed DSH baseline:

```mermaid
flowchart TB
  User["Terminal user"] --> CLI["dsh-code launcher"]
  CLI --> TUI["Terminal host<br/>Pi-inspired UX + pi-tui"]
  TUI --> API["Public DSH services<br/>session/event + AgentHandle"]
  API --> DSH["@deepseek-ai/dsh-base"]
  DSH --> Runtime["Agent Loop · Sessions · Models · Tools<br/>Sandbox · Permissions · MCP · Skills<br/>Plan/Todo · Sub-agents"]
```

The launcher owns only product concerns: command parsing, `~/.dsh-code` home
isolation, project trust, session selection, profile initialization, updates,
and delegation to the upstream DSH executable. The TUI renders structured
events and sends input back through the public `AgentHandle` API.

See the accepted architecture decisions in [`docs/adr/`](docs/adr/) and the
exact upstream revision in [`UPSTREAM_BASELINE.md`](UPSTREAM_BASELINE.md).

## Requirements

| Component | Supported in the first release |
| --- | --- |
| macOS | 14 or later, Apple Silicon (`arm64`) |
| Windows | Windows 10 or later, x64 |
| Node.js | `22.19+` (Node 23 excluded) or `24+` |
| Package manager | npm for normal installation |

Linux, macOS Intel/Rosetta, Windows ARM, and standalone installations without
Node.js are not supported in the first release.

## Installation

### npm

```bash
npm install -g @tsingwill/dsh-code
```

Verify the installation:

```bash
dsh-code --version
dsh-code --help
```

The scoped npm package is `@tsingwill/dsh-code`; the installed command remains
the shorter `dsh-code`.

### Build from source

```bash
git clone --recurse-submodules https://github.com/guoxiucai/dsh-code.git
cd dsh-code
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm run build:lib
pnpm run build
node lib/bin.js
```

## Quick start

```bash
cd /path/to/your/project
dsh-code
```

On the first launch for a project:

1. Review the canonical project path and choose a permission preset.
2. If `~/.dsh-code/.credentials.yaml` has no saved API credential, dsh-code
   automatically opens the inline provider setup.
3. Select a provider, save the first API token and default model, then send a
   task in the editor. Use `/config` later to add or change providers.

For the official DeepSeek API, `/config` asks for the API key and default model.
For an OpenAI-compatible service, the wizard keeps five explicit values:

1. provider route ID;
2. base URL;
3. credential environment-variable name (pre-filled from the route ID);
4. API key;
5. model ID.

The wizard uses DeepSeek-compatible examples, supports `Esc` to return to the
previous step, and writes values only after the final step succeeds. Credentials
are stored owner-only in `~/.dsh-code/.credentials.yaml`.

## Usage

### Command line

| Command | Description |
| --- | --- |
| `dsh-code` | Start a new interactive TUI session |
| `dsh-code -c`, `--continue` | Continue the latest session for this project |
| `dsh-code -r`, `--resume` | Open the searchable session picker |
| `dsh-code resume [session-id]` | Resume a selected or explicit session |
| `dsh-code -p "<task>"` | Run one headless task and print the final answer |
| `dsh-code -p "<task>" --approve` | Trust the project non-interactively using `workspace-write` |
| `dsh-code plugin <command>` | Delegate profile plugin management to DSH (requires pnpm) |
| `dsh-code update --check` | Check the stable npm channel for an update |
| `dsh-code update` | Confirm and install the available update |
| `dsh-code update --channel next` | Select the release-candidate channel |

### Interactive commands

| Command | Description |
| --- | --- |
| `/config` | Configure DeepSeek, OpenAI, or an OpenAI-compatible provider |
| `/model` | Switch the active model using an inline selector |
| `/permission` | Select the active permission preset |
| `/mcp add` | Add a stdio or Streamable HTTP MCP server to this project |
| `/mcp remove <name>` | Remove a project MCP server |
| `/session` | Show session, message, tool, model, and token statistics |
| `/fork` | Fork at the most recent completed turn |
| `/compact` | Compact the current context through DSH |
| `/quit`, `/exit` | Exit when the agent is idle |
| `!<command>` | Run a shell/PowerShell command without sending it to the model |

Additional commands supplied by the pinned DSH profile remain discoverable
through `/` autocomplete.

### Essential keys

| Key | Action |
| --- | --- |
| `Enter` | Send input or confirm an inline selection |
| `Esc` | Go back/cancel an inline step; interrupt the active turn |
| `Ctrl+C` / `Command+C` | Copy the selected result text; never interrupts the active turn |
| `Ctrl+O` | Expand or collapse reasoning (latest 5 lines by default) and tool output |
| `Ctrl+D` | Exit when idle |
| `/` | Open command completion |
| `@` | Complete project files (`fd` enables faster fuzzy discovery) |

## Sessions, configuration, and isolation

By default all dsh-code state lives under `~/.dsh-code`:

```text
~/.dsh-code/
├── .credentials.yaml       # owner-only provider credentials
├── profiles/dsh-code/      # fixed DSH profile + terminal host patch
├── projects/               # canonical-path trust records
└── sessions/               # persisted sessions grouped by project
```

Set `DSH_CODE_HOME` to use a different root. On launch, dsh-code sets the
delegated `DSH_HOME` to this isolated directory and disables DSH telemetry. It
does not read or overwrite `~/.dsh`, and a globally installed upstream `dsh`
binary remains independent.

Project MCP configuration is written to `.dsh-code/cordis.patch.yml` inside the
trusted project and takes effect on the next launch.

## Updating

Updates are explicit; dsh-code does not silently update itself:

```bash
dsh-code update --check
dsh-code update
dsh-code update --channel next
dsh-code update --version 0.1.0-rc.1
```

The update command is supported for npm-global installations. Source checkouts
should be updated with Git and rebuilt with the same tool that installed them.

## Development and verification

```bash
pnpm run typecheck
pnpm test
pnpm run build
```

The repository pins DeepSeek Harness as the `deepseek-harness/` git submodule.
Product code stays at the repository root; upstream changes belong in a
dedicated baseline update or should be contributed to DSH first.

Release design, platform compilation, candidate verification, and the update
strategy are documented in [`docs/NPM_RELEASE.md`](docs/NPM_RELEASE.md).

## Contributing and security

- Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.
- Use [GitHub Issues](https://github.com/guoxiucai/dsh-code/issues) for public
  bug reports and feature requests.
- Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).
- Never attach unredacted API keys, session logs, credentials, or crash logs.

## Relationship and attribution

`dsh-code` is a downstream, independent community project. It is not affiliated
with or endorsed by DeepSeek AI or the Pi maintainers.

- Agent runtime: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- TUI renderer and interaction inspiration: [Pi](https://github.com/earendil-works/pi)
- Product distribution and terminal host: this repository

The dsh-code terminal-whale logo adapts the official DeepSeek whale silhouette
with a terminal window and prompt. The DeepSeek name and official whale artwork
belong to their respective owners; see [`NOTICE`](NOTICE) for complete attribution.

## License

[MIT](LICENSE) © 2026 guoxiucai. Third-party notices are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
