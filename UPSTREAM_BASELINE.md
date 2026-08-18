# Upstream Baseline

> Immutable upstream anchor for `dsh-code`. Any dsh-code product release binds to
> the exact commit recorded here; a deliberate upgrade follows the submodule
> procedure below.

```yaml
repository: https://github.com/deepseek-ai/deepseek-harness
submodule_path: deepseek-harness
branch: master
commit: 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca
commit_subject: "Merge pull request #2620 from deepseek-harness/release/dsh-0.1.0-rc.7"
adopted_at: 2026-08-18
dsh_version: 0.1.0-rc.7
node_engines: "^22.19.0 || >=24.0.0"
package_manager: "pnpm@11.7.0"
pi_tui_version: 0.84.2
```

## Upstream layout

Upstream `deepseek-ai/deepseek-harness` is vendored as a **git submodule** at
`deepseek-harness/`, pinned to the immutable commit above. Upgrading:

```bash
cd deepseek-harness
git fetch
git checkout <sha>          # the new immutable commit
cd ..
pnpm install && pnpm run build:lib && pnpm run build && pnpm test
git add deepseek-harness
# update `commit` / `dsh_version` above, then bump dsh-code's own version
```

Never auto-upgrade on a schedule.

## Scope of local changes

`dsh-code` is a downstream product. All product code lives at the repo root
(`src/**`, `tests/**`, `docs/**`, root `package.json` / `tsconfig.json` /
`pnpm-workspace.yaml` / `vitest.config.ts` / `patches/**`). Upstream lives in the
read-only `deepseek-harness/` submodule; nothing outside the submodule modifies
upstream sources.
