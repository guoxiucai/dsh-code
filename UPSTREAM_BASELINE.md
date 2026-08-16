# Upstream Baseline

> Immutable upstream anchor for `dsh-code`. Any dsh-code product release binds to
> the exact commit recorded here; a deliberate upgrade follows the upstream sync
> procedure in `apps/dsh-code/README.md`.

```yaml
repository: https://github.com/deepseek-ai/deepseek-harness
branch: master
commit: 47f943859bef60e4160492346772ded9b24f765a
commit_subject: "Merge pull request #2519 from deepseek-harness/feat/npm-public"
adopted_at: 2026-08-16
dsh_version: 0.1.0-rc.5
node_engines: "^22.19.0 || >=24.0.0"
package_manager: "pnpm@11.7.0"
pi_tui_version: 0.84.2
```

## Remote layout

- `github` — upstream `deepseek-ai/deepseek-harness` (read-only merge source).
- `origin` — the local dsh-code development remote (fork / private mirror).

`git fetch github` + merge a pinned SHA into an `upgrade/upstream-<date>` branch to
absorb upstream changes; never auto-merge on a schedule.

## Scope of local changes

`dsh-code` is a downstream product. All product code lives under `apps/dsh-code/**`;
the only other files touched are the root lockfile, this baseline record, and
dsh-code's own CI/release/docs. Upstream `packages/**` (core, agent, sandbox, mcp,
subagent, bundles) are read-only. Any change outside `apps/dsh-code/**` requires an
ADR and is reported by the upstream-diff allowlist gate.
