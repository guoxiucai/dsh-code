# Contributing

Thanks for helping improve dsh-code. The project is a thin downstream terminal
host over a pinned DeepSeek Harness submodule; product changes belong at the
repository root, while upstream source changes should be proposed upstream.

## Development setup

```bash
git clone --recurse-submodules https://github.com/guoxiucai/dsh-code.git
cd dsh-code
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm run build:lib
pnpm run typecheck
pnpm test
pnpm run build
```

Use Node.js 22.19+ (excluding Node 23) or Node.js 24+. Keep the submodule at the
commit recorded in `UPSTREAM_BASELINE.md` unless the change is a dedicated,
reviewed upstream-baseline update.

## Pull requests

- Keep product code outside `deepseek-harness/`.
- Add or update tests for behavior changes.
- Do not commit credentials, generated `lib/` or `dist/` output.
- Run typecheck, tests, and build before opening a pull request.
- Explain user-visible behavior, platform impact, and release risk.

By contributing, you agree that your contribution is licensed under the MIT
License in this repository.
