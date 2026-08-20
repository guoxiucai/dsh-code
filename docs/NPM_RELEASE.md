# dsh-code npm 发行实施方案

> 状态：发布实现与 macOS/Windows CI 候选包验收完成；待 Windows 10 真机验收和首次 RC
> 编写日期：2026-08-19
> 最近验收：2026-08-20
> 首批目标平台：macOS arm64、Windows x64
> 用户入口：`npm install -g @tsingwill/dsh-code` → `dsh-code`

本文档是 npm 发行工作的实施基线，以当前仓库和固定的
DeepSeek Harness `0.1.0-rc.7` 为准。`docs/technical-implementation-plan.md`
中的 npm 章节仅保留为早期目标；两者冲突时以本文档为准。

## 1. 执行结论

首版推荐发布一个公开产品包 `@tsingwill/dsh-code`，不发布两个平台子包，也不把
pnpm workspace 的 `node_modules` 物理塞进 tarball。产品包以精确版本依赖已发布的
`@deepseek-ai/dsh` / `@deepseek-ai/dsh-base` 及 dsh-code 自身的 TUI 依赖，并在发布件中
携带 `npm-shrinkwrap.json` 锁定完整运行时依赖树。

对用户而言，上游 DSH 和下游 dsh-code 仍是一个产品：

```text
npm install -g @tsingwill/dsh-code
        │
        └─ dsh-code
             ├─ lib/**                         # 下游 CLI/TUI
             └─ node_modules/@deepseek-ai/dsh # 固定上游运行时
```

npm 会在安装目标机上自动选择 Darwin arm64 或 Win32 x64 的原生预编译依赖。
因此 JavaScript 产品 tarball 只构建一次，但必须在两个真实平台分别执行 clean
global install 和运行时验收，验收通过的同一个 tarball 才能发布。

此处的“整体打包”指一次 npm 安装获得完整产品依赖闭包，不是一个可离线
安装、物理内含所有依赖的单 tarball。如以后有离线安装要求，应另立 RFC，
改为入口包 + Darwin/Windows 平台 payload 包，不在首版混入这个复杂度。

## 2. 当前仓库审计结果

### 2.1 已验证可行的部分

- npm 上已存在 `@deepseek-ai/dsh@0.1.0-rc.7` 和
  `@deepseek-ai/dsh-base@0.1.0-rc.7`，上游 workspace 包有对应的公开发布版。
- 当前源码已将 dsh-code home 固定为
  `DSH_CODE_HOME ?? ~/.dsh-code`，并在委托上游前设置 `DSH_HOME`；不会读写
  上游默认的 `~/.dsh`。
- `src/cli/delegate.ts` 从 dsh-code 自己的依赖树解析
  `@deepseek-ai/dsh/package.json`，不通过 PATH 调用用户机器上的 `dsh`。
- 在 macOS arm64 的临时 npm 全局前缀中，当前产品 tarball 加 npm 上的上游
  依赖可完成安装，`dsh-code --version` 和 `--help` 可运行。
- 在同一临时前缀另外全局安装 `@deepseek-ai/dsh`后，`dsh` 和
  `dsh-code` 的 bin 同时存在，dsh-code 仍解析自己目录下的 DSH。
- GitHub Actions 已将同一个 candidate tarball 分别在 macOS arm64、Windows x64
  的 Node 22.19/24 环境完成 clean global install、CLI 和固定运行时验证；Node 22
  组还通过同名不同版本 fixture 验证了全局 `dsh` bin 共存。
- 实测 `0.1.0-rc.1` candidate tarball（含中英文 README、SVG 品牌资源与产品截图）约 216 KiB，完整全局安装目录此前基线约 317 MB。后者需设
  体积预算和回归门禁，但不构成 npm tarball 上限问题。

### 2.2 已解决缺口与剩余阻断项

已完成：

- 根 package 保持 `private: true`，发布脚本在 `dist/npm/package` 生成非 private staging manifest；
- staging 将 workspace 依赖转换为精确版本，并生成可发布的 `npm-shrinkwrap.json`；
- staging 将全部可达 `@deepseek-ai/dsh*` 运行包提升为精确 direct dependencies，防止 npm peer 自动安装混入其他 RC；
- tarball 文件 allowlist、secret/local dependency、体积、SHA-256 和跨平台 optional metadata 门禁；
- POSIX `chmod` 已换成跨平台 Node 脚本，shell 指示文案按 PowerShell/Shell 区分；
- 已补 MIT LICENSE、NOTICE 和上游第三方 notices；
- 已实现安装平台组合校验和 `dsh-code update`；
- 已实现 macOS/Windows、Node 22.19/24 的 CI candidate smoke 和 protected publish workflow；
- macOS arm64 和 Windows x64 均已从同一个真实 tarball clean global install，并用
  同名不同版本 fixture 验证全局 `dsh` bin 与产品运行时隔离。

首次 RC 前剩余阻断项：

1. 在 Windows 10 x64 真机完成最低系统交互验收；
2. 首次人工 publish 后配置 trusted publisher 和 `release` environment approval。

2026-08-20 的跨平台验收记录为 GitHub Actions run
[`32272499534`](https://github.com/guoxiucai/dsh-code/actions/runs/32272499534)：candidate
构建以及 macOS arm64 / Windows x64 的 Node 22.19 / 24 四组 smoke 全部通过。CI 的
Windows runner 为 Windows Server 2025，此记录不能替代上表声明的 Windows 10 最低版本真机验收。

### 2.3 已确认的 npm/GitHub 发布身份

2026-08-19 已在本机登录状态下完成确认：

| 项目 | 已确认值 |
| --- | --- |
| npm 用户名 / scope | `tsingwill` |
| npm registry | `https://registry.npmjs.org/` |
| 本机 npm CLI | `11.15.0`，已满足 trusted publishing CLI 要求 |
| npm 账号 2FA | 已开启 `auth-and-writes` |
| 最终 npm 包名 | `@tsingwill/dsh-code` |
| scoped 包占用情况 | 当前未发布，可用于首次发布 |
| GitHub 仓库 | `guoxiucai/dsh-code` |
| GitHub 可见性 | Public |
| GitHub 仓库发布控制权 | 已确认，作为长期发布仓库 |
| 全局安装命令 | `npm install -g @tsingwill/dsh-code` |
| 安装后的 CLI 命令 | `dsh-code` |

目标 package manifest 固定为：

```json
{
  "name": "@tsingwill/dsh-code",
  "bin": {
    "dsh-code": "lib/bin.js"
  }
}
```

公开 npm registry 中的非 scoped 包 `dsh-code` 已由其他所有者占用，因此不能把本项目
发布成该名称。用户必须使用 scoped 安装命令，但安装完成后的终端命令仍保持
`dsh-code`，产品使用体验不变。发布脚本仍应从目标 package manifest 动态读取包名，
避免在多个脚本中重复硬编码。

### 2.4 尚需用户完成的账号事项

仓库、版权主体、版本节奏、支持范围和 npm 2FA 均已确认。首次 RC 前只剩以下账号本人操作：

1. 确认 npm 2FA 恢复码已妥善保存；
2. 首次 bootstrap publish 时完成一次 2FA 验证；
3. 首次 package 存在后复核 trusted publisher 绑定结果；
4. 在 GitHub 仓库设置中启用 `release` Environment approval 和 private vulnerability reporting。

已采用的产品决策：LICENSE copyright holder 为 `guoxiucai`；首发节奏为
`0.1.0-rc.1` → `0.1.0`；GitHub `release` environment 保留一次 maintainer approval。

## 3. 支持范围

### 3.1 V1 支持矩阵

| 平台 | 架构 | 最低系统声明 | Node | CI | 手工验收 |
| --- | --- | --- | --- | --- | --- |
| macOS | arm64 | macOS 14+ | 22.19.x、24.x | `macos-14` | Terminal.app + iTerm2 |
| Windows | x64 | Windows 10 x64 | 22.19.x、24.x | `windows-2025` x64 | Windows Terminal + PowerShell 7 |

最低系统是首版的保守支持声明，不代表代码必然不能运行在更早系统。如要
扩大范围，先增加真机或可信 runner 的安装和 TTY 回归，再修改官方声明。

V1 明确不支持：

- macOS x64 / Rosetta 作为正式支持环境；
- Windows arm64 / x86；
- Linux；
- 不安装 Node 的单一可执行文件分发；
- 离线单 tarball 包含全部依赖。

### 3.2 安装期平台校验

`package.json` 不同时设置 `os: [darwin, win32]` 和 `cpu: [arm64, x64]`，因为 npm
会把它们解释成交叉组合，从而误接受 macOS x64 和 Windows arm64。在 bin 最早期执行
精确组合校验：

```text
darwin-arm64  → supported
win32-x64     → supported
anything else → 友好错误 + 支持矩阵 URL + exit 1
```

校验必须早于 `pi-tui`、`node-pty`、Koffi 等原生闭包加载，否则用户看到的会是
`MODULE_NOT_FOUND` 而不是产品级错误。

## 4. 发布包设计

### 4.1 源码 manifest 和发布 manifest 分离

保留根 `package.json` 用于 pnpm workspace 开发，发布脚本在干净的
`dist/npm/dsh-code/` 生成 staging package。不在源码 manifest 上做发布时原地替换，
避免失败后遗留半修改状态。

目标 manifest 至少包含：

```json
{
  "name": "@tsingwill/dsh-code",
  "version": "<release-version>",
  "description": "Terminal coding agent powered by DeepSeek Harness",
  "type": "module",
  "license": "MIT",
  "bin": { "dsh-code": "lib/bin.js" },
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/guoxiucai/dsh-code.git"
  },
  "homepage": "https://github.com/guoxiucai/dsh-code#readme",
  "bugs": { "url": "https://github.com/guoxiucai/dsh-code/issues" },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "files": [
    "lib",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "UPSTREAM_THIRD_PARTY_NOTICES.md",
    "UPSTREAM_BASELINE.md",
    "npm-shrinkwrap.json"
  ],
  "dependencies": {
    "@deepseek-ai/dsh": "0.1.0-rc.7",
    "@deepseek-ai/dsh-base": "0.1.0-rc.7",
    "@deepseek-ai/dsh-agent": "0.1.0-rc.7",
    "@deepseek-ai/dsh-session": "0.1.0-rc.7",
    "@deepseek-ai/dsh-llm": "0.1.0-rc.7",
    "@deepseek-ai/dsh-credentials": "0.1.0-rc.7",
    "@deepseek-ai/dsh-settings": "0.1.0-rc.7",
    "@earendil-works/pi-tui": "0.84.2",
    "diff": "9.0.0",
    "js-yaml": "4.3.1"
  }
}
```

注意：

- 不含 `private`，或显式设置为 `false`；
- 不含 `workspace:`、`link:`、`file:`、Git URL 依赖；
- 发布 manifest 不携带开发脚本和 devDependencies；
- `repository.url` 必须与 npm trusted publisher 使用的 GitHub 仓库大小写完全一致；
- package name 已确认为 `@tsingwill/dsh-code`；repository 固定为当前公开仓库，
  二者变化时必须重新评审 trusted publisher 配置。

### 4.2 完整依赖锁定

发布 staging 中用 npm 生成 `package-lock.json`，再执行 `npm shrinkwrap`，将它转为
会随包发布的 `npm-shrinkwrap.json`。这个文件是产品可重现性的一部分，不是
可忽略的临时产物。

生成后的门禁：

- 所有 `@deepseek-ai/*` 都锁定到与 `UPSTREAM_BASELINE.md` 一致的版本组；
- lock 中同时存在 Darwin arm64 和 Win32 x64 的 optional package 元数据；
- lock 中没有 workspace/link/file/git 解析；
- 所有 registry URL 是预期的 npm registry；
- 同一 commit 重新生成后，依赖名、版本和 integrity 不发生漂移。

### 4.3 原生依赖

当前运行闭包含 `node-pty`、`node-addon-require-builtin`、Koffi 和 pi-tui 携带的平台
预编译产物。发布流程必须证明两个平台安装时选中正确产物，而不是在 CI
上悄然从源码编译成功。

当前上游 `@deepseek-ai/dsh-subprocess-local` 有 postinstall，用于恢复 macOS
`spawn-helper` 的可执行位。这个脚本不下载外部二进制，但仍应记录在安装
脚本 allowlist 和 NOTICE 中。使用 `npm install --ignore-scripts` 的环境在完成专门验证前
不列为受支持安装方式。

### 4.4 包内容和体积门禁

`npm pack --dry-run --json` 和真实 `npm pack` 都要审计：

- 只有 allowlist 文件；
- 没有 `.git`、`.github`、`deepseek-harness/`、`src/`、`tests/`、`dev_doc/`、`.DS_Store`、
  本地绝对路径、凭证、session 或 crash log；
- bin shebang 存在，Unix mode 为 0755；
- 产品 tarball 首版预算 ≤ 1 MiB；
- macOS 完整安装预算先设为 ≤ 400 MiB，后续只能通过显式评审上调；
- 生成 SHA-256，平台验收和最终发布使用同一个字节级 tarball。

## 5. 构建和一键发布设计

### 5.1 已新增文件

```text
scripts/
  release.mjs             # 本地一键入口，版本/分支/上游/工作区预检
  build-release.mjs       # 生成干净 staging package + shrinkwrap + tarball
  verify-tarball.mjs      # manifest/文件/依赖/体积/secret 门禁
  smoke-install.mjs       # 临时 npm prefix 安装与共存测试
  publish-candidate.mjs   # 仅允许 GitHub Actions 发布已验收 candidate
.github/workflows/
  ci.yml                  # PR 和 main 双平台验证
  release.yml             # tag 触发，构建、矩阵验收、OIDC 发布
```

全部逻辑用 Node ESM 编写，不分别维护 bash 和 PowerShell 两套核心发布逻辑。
平台 shell 只作为必要的薄包装。子进程统一使用 argv 数组和 `shell: false`，防止版本号、
路径或 registry 参数进入 shell 注入面。

### 5.2 本地一键入口

目标用法：

```bash
pnpm release -- 0.1.0-rc.1 --tag next
pnpm release -- 0.1.0 --tag latest
```

`release.mjs` 不在开发机保存 npm token，也不默认在开发机运行
`npm publish`。它完成：

1. 检查 Node/pnpm 版本、Git 工作区干净、当前分支和 origin；
2. 检查上游 submodule SHA 与 `UPSTREAM_BASELINE.md` 一致；
3. 检查目标版本合法、未在 npm 和 Git tag 中使用；
4. 校验 RC 只使用 `next`，稳定版才可使用 `latest`；
5. 运行本地 typecheck/test/build/pack/manifest 预检；
6. 要求版本说明和代码已经提交，在当前 commit 创建 annotated tag；
7. 推送 main/tag，由 GitHub Actions 完成真正的双平台验收和 npm 发布。

为避免误发，推荐给 GitHub `release` environment 配置一次 maintainer approval。
这是“一条本地命令 + 一次发布确认”；如未来确实需要全自动，可移除 environment
approval，但不应移除矩阵、包审计和 registry 版本检查。

### 5.3 GitHub Actions 发布拓扑

```text
prepare (ubuntu, Node 22.19)
  checkout --recurse-submodules
  → pnpm install --frozen-lockfile
  → build upstream host/client
  → typecheck + tests + dsh-code build
  → build staging + npm-shrinkwrap + tarball audit
  → upload candidate.tgz + sha256
          │
          ├─ smoke-macos-arm64 (macos-14, Node 22.19 + 24)
          │    clean global prefix + TTY/manual-capable smoke
          │
          └─ smoke-windows-x64 (windows-2025, Node 22.19 + 24)
               clean global prefix + PowerShell smoke
                    │
publish (ubuntu, GitHub-hosted, protected environment)
  download the exact candidate.tgz
  → verify SHA/version/tag/registry non-existence
  → npm publish candidate.tgz --access public --tag <next|latest>
  → install from registry and post-publish smoke
  → create GitHub Release with checksum and upstream SHA
```

只有 publish job 获得：

```yaml
permissions:
  contents: write
  id-token: write
```

npm 使用 GitHub Actions trusted publishing (OIDC)，不配置长期 `NPM_TOKEN`。发布 runner
使用 Node 22.19 且显式安装 npm ≥ 11.15.0。trusted publishing 自动生成 provenance，
前提是公开 GitHub 仓库、公开 npm 包、GitHub-hosted runner 和精确匹配的 repository。

所有 Actions 应锁定到已评审的完整 commit SHA，不只使用浮动 major tag。

### 5.4 首次发布的 bootstrap 流程

npm trusted publisher 只能绑定已经存在的 package，因此 `@tsingwill/dsh-code` 的第一次
发布是唯一一次例外，不能直接依靠尚未建立的 OIDC 信任关系。推荐流程：

1. npm 账号开启 2FA；
2. 建立 `release.yml`，让 `0.1.0-rc.1` candidate 先完成 macOS arm64 和 Windows x64
   验收，但暂不执行 publish job；
3. 下载并核对同一个 candidate tarball 和 SHA-256，在本机用 2FA 手工执行：

   ```bash
   npm publish ./candidate.tgz --access public --tag next
   ```

4. 使用 npm ≥ 11.15.0，将该包绑定到唯一的 trusted publisher：

   ```bash
   npm trust github @tsingwill/dsh-code \
     --repo guoxiucai/dsh-code \
     --file release.yml \
     --env release \
     --allow-publish
   ```

5. 在 npm 网站复核 publisher 和 provenance 设置；此后的 RC/stable 均只通过受保护的
   GitHub `release` environment 发布，不再使用本地 write token。

npm 账号、GitHub owner/repository、workflow 文件名或 environment 任一变化，都必须先更新
trusted publisher；npm package 同一时刻只保留一个 trusted publisher。

## 6. macOS arm64 编译与验收指引

### 6.1 环境

- Apple Silicon，macOS 14 或更高；
- Git；
- Node 22.19.x 或 24.x；
- pnpm 11.7.0；
- 正常的 npm registry 网络。

原则上不要求用户安装 Xcode/clang/Python。如 clean install 调用了本地编译器，应当视为
预编译产物选择失败，而不是“CI 编译成功”。

### 6.2 开发构建

```bash
uname -s
node -p "process.platform + '-' + process.arch"
node --version
pnpm --version

git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm run build:lib
pnpm run typecheck
pnpm test
pnpm run build
```

预期平台是 `darwin-arm64`。不在 Rosetta shell 中生成或验收 RC。

### 6.3 产品包验收

实施发布脚本后，应使用：

```bash
pnpm run release:pack
pnpm run release:verify
pnpm run release:smoke -- --platform darwin-arm64
```

smoke 脚本必须使用 `mktemp -d` 生成独立 npm prefix，至少验证：

1. `npm install -g --prefix <temp-prefix> <candidate.tgz>`；
2. `<temp-prefix>/bin/dsh-code --version` 与 tarball 版本一致；
3. `--help` 无本地开发路径；
4. dsh-code 内部解析到自己的 `@deepseek-ai/dsh`；
5. Darwin arm64 原生包和 `node-pty` `spawn-helper` 存在、可加载/可执行；
6. 在含空格和中文的项目路径中启动、信任、执行 shell、退出后终端恢复；
7. 再全局安装上游 `@deepseek-ai/dsh@<baseline>`，`dsh`/`dsh-code`
   同时可用且 home/配置/session 完全分离；
8. 卸载 dsh-code 不删除 `~/.dsh-code`，不影响 dsh。

## 7. Windows x64 编译与验收指引

### 7.1 环境

- Windows 10 x64 或更高（CI 使用 GitHub `windows-2025` x64，并补充 Windows 10 真机验收）；
- Git for Windows，启用 long paths；
- Node 22.19.x 或 24.x x64；
- pnpm 11.7.0；
- Windows Terminal + PowerShell 7 作为主验收终端。

用户安装不应要求 Visual Studio Build Tools、Python 或 node-gyp。

### 7.2 PowerShell 构建

```powershell
[Environment]::Is64BitOperatingSystem
node -p "process.platform + '-' + process.arch"
node --version
pnpm --version

git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm run build:lib
pnpm run typecheck
pnpm test
pnpm run build
```

预期平台是 `win32-x64`。执行这个流程前必须先移除 `package.json` 的 POSIX-only
`chmod` 命令，并确认上游 build 脚本在含空格的 checkout 路径可运行。

### 7.3 产品包验收

```powershell
pnpm run release:pack
pnpm run release:verify
pnpm run release:smoke -- --platform win32-x64
```

Windows smoke 至少验证：

1. 临时 prefix 内生成 `dsh-code.cmd`；
2. `dsh-code.cmd --version` / `--help` 可在 PowerShell 和 `cmd.exe` 运行；
3. 选中 win32-x64 的 `node-addon-require-builtin`、Koffi 和 node-pty/ConPTY 资产；
4. `!` shell 模式使用上游的 PowerShell 路径，UI 不显示错误的 bash 承诺；
5. Ctrl+C/Ctrl+D/Esc、窗口 resize、中文/宽字符和 ANSI color 不破坏终端；
6. 项目路径包含空格、中文和较长路径时仍可启动；
7. 与全局 `dsh` 共存、分别卸载、分别升级不相互删除；
8. Windows Defender 开启时无未解释的二进制拦截；如有，必须记录产物来源和
   处理方案，不要诱导用户关闭杀毒软件。

## 8. 与上游 dsh 的隔离合同

发布后必须持续满足：

| 维度 | dsh-code | 上游 dsh |
| --- | --- | --- |
| npm bin | `dsh-code` | `dsh` |
| 默认 home | `~/.dsh-code` | `~/.dsh` / 上游默认 |
| 环境覆盖 | `DSH_CODE_HOME` | 上游自有变量 |
| DSH 运行时 | 从 dsh-code 包内依赖树解析 | 上游全局包自己的树 |
| profile/config/session | 只在 dsh-code home | 只在上游 home |
| 更新 | 只更新 npm 产品 `@tsingwill/dsh-code` | 由用户单独更新 dsh |

禁止为 dsh-code 声明 `dsh` bin，禁止通过 `spawn('dsh')` 委托上游，禁止默认继承环境
中已有的 `DSH_HOME`。共存测试是每个 RC 的 P0 门禁，不是仅首发测一次。

## 9. `dsh-code update` 实现方案

### 9.1 用户交互

```text
dsh-code update --check                 # 只检查，不修改安装
dsh-code update                         # 检查并在 TTY 确认后升级 stable
dsh-code update --yes                   # 非交互升级 stable
dsh-code update --channel next          # 显式选择 RC 通道
dsh-code update --version 0.1.0          # 安装/回滚到精确版本
```

不在启动 TUI 时自动联网，不静默自更新，不在产品升级后自动升级用户插件。
插件更新是另一个可回滚的显式操作，不与 npm 产品替换绑定。

### 9.2 升级流程

1. 从已安装的 `package.json` 读取真实 package name/version；正常发布值应为
   `@tsingwill/dsh-code`，仍不在 update 代码中重复硬编码；
2. 确认当前入口位于 npm global root。如果是 source checkout、`npm link`、npx 或其他
   包管理器，只输出对应建议，不自我覆盖；
3. 解析 npm 可执行文件：macOS 使用 `npm`，Windows 使用 `npm.cmd`；
4. 通过 `npm view <package>@<channel> version --json` 查询，从而尊重用户的 proxy、CA 和
   registry 配置。设置超时，校验返回值是合法 semver；
5. 将 channel 解析成精确版本后再安装，不将未验证的字符串交给 shell；
6. TTY 显示“当前 → 目标”、上游 baseline 和 release notes URL，等待确认；
7. 用 `spawn` + `shell: false` 执行
   `npm install --global <package>@<exact-version>` 并继承 stdio；
8. 安装成功后用 `npm list --global <package> --depth=0 --json` 校验已安装版本；
9. 输出“重新运行 dsh-code”；不在旧进程内继续启动新 TUI。

Windows 如出现文件占用 `EPERM`，V1 先保留当前安装并输出可复制的精确命令；
若实测证明稳定复现，再增加拷贝到 `os.tmpdir()`、等待父进程退出后执行的专用
update helper。不先入为主实现，也不使用 shell 延时命令。

### 9.3 数据和权限安全

- update 只替换 npm 程序包，不删除 `~/.dsh-code`；
- 配置/session schema 如有升级，必须是可重入迁移，首次写前做可恢复备份；
- 权限错误只给出 Node version manager/npm prefix 指引，绝不自动使用 `sudo` 或提权；
- 网络、registry、proxy、证书、磁盘空间或 install script 失败时，保留旧版或给出
  精确恢复命令；
- 不记录 npm token、`.npmrc` 内容或凭证环境变量。

## 10. 版本、通道和回滚

### 10.1 版本规则

- dsh-code 使用自己的 SemVer，不必与 DSH 版本号相同；
- 每个 dsh-code 版本在 `UPSTREAM_BASELINE.md` 绑定不可变的上游 commit SHA 和 DSH 版本；
- `next` 只指向 `-rc.N`，`latest` 只指向已完成所有门禁的稳定版；
- npm 上 name + version 一旦发布永久不重用，即使 unpublish 也要换新版本；
- 发错包优先 `npm deprecate`、回退 dist-tag 和发新 patch，不依赖 unpublish。

### 10.2 回滚手册

```bash
npm install -g @tsingwill/dsh-code@<last-known-good>
npm dist-tag add @tsingwill/dsh-code@<last-known-good> latest
npm deprecate @tsingwill/dsh-code@<bad-version> "Known issue: <link>; install <good-version>"
```

dist-tag 回退是 registry 外部状态变更，只允许 release maintainer 在事故手册下执行。
每次正式发布后保留 candidate tarball、SHA-256、provenance、SBOM 和平台验收日志。

## 11. 专业开源项目发布检查

以下项目是用户原始清单之外的必要维度。

### 11.1 法务与品牌

- [x] 根 LICENSE 存在，copyright holder 为 `guoxiucai`，年份为 2026；
- [x] NOTICE 列出 DeepSeek Harness、品牌关系和第三方 notices 入口；
- [x] 发布件携带产品 direct notices 和上游生成的 `UPSTREAM_THIRD_PARTY_NOTICES.md`；
- [ ] 确认 DeepSeek 名称/鲸鱼图形的品牌使用范围，README 明确本项目与上游的关系；
- [x] npm scope/package 确认为 `tsingwill` / `@tsingwill/dsh-code`；
- [ ] 两名以上 maintainer 或等价的账号 recovery 方式确认。

### 11.2 npm 元数据和用户文档

- [x] name/version/description/keywords/repository/homepage/bugs/license/engines/bin 完整；
- [x] README 含安装、升级、支持平台、Node 要求和独立数据目录；
- [ ] CHANGELOG 和 GitHub Release 与发布版本一致；
- [x] `dsh-code update` 已实现，文档与帮助同步；
- [ ] 明确 `npm install --ignore-scripts`、代理/私有镜像和权限错误的支持程度。

### 11.3 供应链与发布安全

- [x] npm 账号已开启 `auth-and-writes` 2FA；后续发布使用 trusted publishing OIDC；
- [ ] npm trusted publisher 精确限制 GitHub owner/repo/workflow/environment；
- [ ] 发布仓库为公开仓库并产生 npm provenance；
- [x] 发布流程生成并审计 `npm-shrinkwrap.json`；
- [ ] lifecycle scripts 清单化、allowlist 化，新增脚本必须阻断发布等待评审；
- [x] candidate 运行 npm production audit，高危/严重漏洞阻断，并生成 CycloneDX SBOM；
- [x] GitHub Actions 使用按 job 最小 permissions，第三方 action 锁 full SHA；
- [x] 发布 job 只从 tag/显式 dispatch + protected environment 进入，PR/fork 无 id-token 发布权限。

### 11.4 可重现性和产物质量

- [ ] clean checkout + recursive submodule + frozen lock 可构建；
- [ ] 上游 SHA/version 与发布包一致；
- [x] workflow 在所有平台传递同一 candidate tarball 和 SHA-256；
- [x] `npm pack --json`、文件 allowlist、secret/local dependency scan 全绿；
- [x] 两个平台均从 tarball 做 clean global install，不使用 workspace/node_modules cache 代替；
- [ ] 发布后再从 npm registry 安装一次，而不只验证本地 tarball；
- [ ] 产品 tarball、安装体积、冷启动和 TUI 启动时间有回归预算。

### 11.5 跨平台产品质量

- [x] macOS arm64 和 Windows x64 的原生包选择受测，不依赖本地编译工具链；
- [ ] Windows PowerShell/cmd 入口、ConPTY、信号/退出、窗口 resize 受测；
- [ ] 暗色/亮色终端、truecolor 退化、中文宽字符、小窗口宽度受测；
- [ ] 路径空格、中文、长路径、只读项目、无写 home 权限有明确错误；
- [x] macOS/Windows candidate 已用同名不同版本 fixture 验证独立 `dsh` bin 共存且产品仍解析固定运行时；
- [ ] 核心功能不要求用户全局安装 pnpm；如 plugin 管理仍需 pnpm，必须检测并给出
  明确安装指引，或由产品使用自己固定的 pnpm 入口。

### 11.6 数据、隐私和运维

- [ ] API key 和 credential 文件权限、日志脱敏、crash log 脱敏经过安全回归；
- [ ] 安装/启动不自动启用遥测，不做隐式更新检查；
- [ ] 升级、降级、schema migration、断电/中断后数据可恢复；
- [x] 有 SECURITY.md、私密漏洞报告入口、支持窗口和安全更新策略；
- [ ] 有发布事故手册，包含 deprecate、dist-tag 回退、公告和事后复盘；
- [ ] 至少两名 maintainer 或一套可恢复的账号/组织所有权方案，避免单人发布风险。

### 11.7 GitHub 开源工程化

- [x] 增加 CONTRIBUTING.md、CODE_OF_CONDUCT.md、SECURITY.md；
- [x] 增加 issue/PR templates 和 CODEOWNERS；依赖自动更新策略待首个稳定版后启用；
- [ ] main 分支保护，要求 CI、评审和禁止 force push；
- [ ] 发布 tag 保护，发布 environment 要求 maintainer approval；
- [ ] 对上游 submodule 升级使用独立 PR，附依赖差异、license 差异和平台回归。

## 12. 实施阶段和验收标准

### Phase A：发布前缺口

1. 固定已确认的 npm package `@tsingwill/dsh-code` 和首发版本 `0.1.0-rc.1`；
2. [完成] npm 账号开启 `auth-and-writes` 2FA；本机 npm 已升级到 `11.15.0`；
3. [完成] 补 LICENSE/NOTICE/package metadata；
4. [完成] 修复 Windows 构建脚本和平台文案；
5. [完成] 增加平台/Node 早期检查；
6. [完成] 实现 staging manifest、shrinkwrap、pack audit 和 clean install smoke。

验收：[通过] 本地 macOS 可从 candidate tarball 安装；Windows CI 可完成同一 tarball 的全流程。

### Phase B：CI/CD 和 RC

1. [完成] 增加双平台 CI；
2. [完成] 增加一键 release 脚本和受保护 workflow；
3. [完成] 按首次 bootstrap 流程发布 `0.1.0-rc.1` 到 `next`；
4. [完成] 配置 npm trusted publisher，后续发布切换到 OIDC/provenance；
5. 从真实 npm registry 在两平台重新安装并手工验收。

验收：`npm install -g @tsingwill/dsh-code@next` 在两平台直接可用；从第二个 RC 起
provenance 可查，
dsh 共存测试通过。

### Phase C：update 和稳定发布

1. [实现完成，macOS registry RC 验收通过] 实现 `dsh-code update`；
2. 验证 stable/next/精确版本/权限错误/网络失败/回滚；
3. 完成安全、license、SBOM、数据迁移和发布事故手册；
4. RC 无 P0/P1 问题后发布 stable，再移动 `latest`。

验收：新安装、显式升级、精确回滚、与 dsh 共存全部通过；发布者不需
在本地保存 npm write token。

## 13. 官方参考

- [npm package.json：private、files、bundle/optional dependencies](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [npm publish：版本不可重用、dry-run、tag](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [npm shrinkwrap：可发布的依赖锁](https://docs.npmjs.com/cli/v11/commands/npm-shrinkwrap/)
- [npm trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [npm 全局包更新](https://docs.npmjs.com/updating-packages-downloaded-from-the-registry/)
- [pnpm workspace 发布时的 workspace protocol 转换](https://pnpm.io/workspaces#publishing-workspace-packages)
- [pnpm deploy 的 portable package 语义](https://pnpm.io/cli/deploy)
- [pnpm supportedArchitectures](https://pnpm.io/settings/dependency-resolution#supportedarchitectures)
- [GitHub-hosted runner 平台/架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub Actions 发布 Node.js 包](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages)
