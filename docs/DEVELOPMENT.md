# dsh-code 开发交接文档

> 本文档面向接手 `dsh-code` 继续开发的工程师。目标读者需要了解：这是什么项目、代码怎么组织的、怎么构建运行、哪些是硬性边界、哪些还没做。
>
> 上游基线：`deepseek-ai/deepseek-harness` @ `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`（`0.1.0-rc.7`），以 submodule `deepseek-harness/` 形式引入。

---

## 1. 项目定位

`dsh-code` 是 DeepSeek Harness（DSH）的**公开下游产品**，定位是：

> `dsh-base` 的 Terminal Host 和独立 npm 产品封装。

它不是新的 Agent 内核，**不重新实现** DSH 已经提供的 Agent Loop、Session、模型适配、工具、Sandbox、权限、MCP、Skills、Plan/Todo、子 Agent。用户安装后：

```bash
npm install -g dsh-code
cd /path/to/project
dsh-code
```

默认进入纯终端交互式 TUI（基于 `@earendil-works/pi-tui` 的 `TuiMainScreen`），不启动 Web Server、不打开浏览器、不用 Electron。

## 2. 仓库与分支

| remote | 指向 | 用途 |
| --- | --- | --- |
| `origin` | `guoxiucai/dsh-code` | 本地开发 / 推送 |

- 开发分支：`main`（干净历史；旧 fork 历史保留在 tag `dsh-code-fork-baseline`）。
- 上游以 **git submodule** 形式放在 `deepseek-harness/`，固定到不可变 SHA。
- 上游升级流程：`cd deepseek-harness && git fetch && git checkout <sha>` → 回根 `pnpm install && pnpm run build:lib && pnpm run build && pnpm test` → `git add deepseek-harness` → 更新 `UPSTREAM_BASELINE.md` 并 bump dsh-code 版本。
- **禁止**自动升级上游，也**禁止**在 npm 安装时动态选最新 DSH Core。

基线记录在仓库根的 `UPSTREAM_BASELINE.md`（submodule 路径 + 精确 SHA + 版本）。

## 3. 架构与硬性边界

### 3.1 分层

```
npm 产品层 (dsh-code)
  → 启动层（参数解析、项目路径、信任、选 Profile）
  → 组合层（dsh-base + dsh-code profile patch，含 TUI plugin）
  → Agent 核心层（上游 DSH）
  → UI Bridge（公开事件 → 纯 ViewModel）
  → TUI 层（pi-tui Main Screen）
```

### 3.2 硬性不变量（代码审查必须遵守）

1. TUI 只能通过 DSH **公开服务、公开事件和 Agent Handle** 操作 Agent。
2. **不得**直接导入 `agent-loop` 内部实现。
3. **不得**建立第二套 Session Store、Provider Store、Permission Engine 或 Tool Registry。
4. **不得**在 TUI 中根据文本猜测工具状态；必须消费结构化 Session 事件。
5. 相同 DSH 配置和模型响应下，TUI 与 headless 路径的核心 Session 语义等价。
6. `dsh-code` 退出时必须调用上游 flush/dispose 路径。
7. 项目未信任前，不得加载项目级插件、MCP、Skills 或 `.dsh-code` patch。

### 3.3 允许修改的文件

- 仓库根 `src/**`、`tests/**`、`docs/**`（产品代码全在这里）
- 根 `package.json` / `tsconfig.json` / `pnpm-workspace.yaml` / `vitest.config.ts` / `patches/**` / lockfile
- dsh-code 自己的 CI workflow / release 配置、README/CHANGELOG / `UPSTREAM_BASELINE.md`

上游在只读 submodule `deepseek-harness/` 里，默认**禁止**修改其任何文件（`packages/core/**`、`packages/agent/**`、`packages/sandbox/**`、上游 bundle 配置、上游 Session 事件格式等）。若必须改，需 ADR + 说明 + 可上游化 PR。

## 4. 目录结构

```
dsh-code/                       # 仓库根 = workspace 根 + dsh-code 包
  deepseek-harness/             # 上游 DSH（git submodule，只读，固定 SHA）
  package.json                  # bin: dsh-code → lib/bin.js；依赖 @deepseek-ai/dsh、pi-tui 等
  pnpm-workspace.yaml           # workspace globs 指向 deepseek-harness/**
  tsconfig.json                 # 纯 tsc 编译（非 tsdown），emit 到 lib/
  docs/
    DEVELOPMENT.md              # 本交接文档
    technical-implementation-plan.md   # 设计文档（含 Phase 规划、测试矩阵）
    adr/0001-thin-terminal-host.md     # ADR-001 薄终端宿主
    adr/0002-launcher-delegation.md    # ADR-002 启动器委托
  src/
    bin.ts                     # CLI 入口（产品动词、信任、委托、软链 entry 检测）
    cli/
      args.ts                  # 产品参数解析（help/version/resume/-p/config/plugin/import/update）
      delegate.ts              # spawn 上游 @deepseek-ai/dsh/lib/bin.js
    bootstrap/
      home.ts                  # DSH_CODE_HOME 解析（~/.dsh-code，隔离于 ~/.dsh）
      trust.ts                 # 项目信任（canonical path + sha256 + 三档权限）
      trust-picker.ts          # 全屏 TUI 信任选择器
      profile.ts               # 初始化 dsh-code profile（bundles: dsh-base + TUI patch）
      sessions.ts              # 会话列表：projectKey + zstd 多 frame 解码 + 首条用户消息
      resume-picker.ts         # 全屏会话选择器（-r/--resume：搜索/删除二次确认/Tab 切换项目范围）
    tui/
      plugin.ts                # ★ Cordis plugin（注入服务、创建/恢复 agent、注册命令、接线）
      host.ts                  # ★ TuiHost（pi-tui 主屏、渲染、加载态、选择器、shell 结果块）
      reducer.ts               # ★ 纯函数 session/event → ViewModel（去重/乱序 fail-fast/折叠）
      view-model.ts            # ViewModel 类型（TranscriptItem / RetryStatus / ToolDiff 等）
      theme.ts                 # ANSI 调色板（userBg/toolBg/border/bashBorder/selectorBorder…）
      selector.ts              # 内联列表选择器（model/permission picker）
      project-config.ts        # 读写项目 .dsh-code/cordis.patch.yml（MCP 配置）
  tests/
    unit/                      # reducer / args / trust / sessions / project-config
    integration/mock-loop.spec.ts   # mock LLM 闭环 + 缺凭证失败路径
    fixtures/mock-adapter.mjs       # 无 key 的确定性 mock LLM 适配器
    fixtures/mock.cordis.yml        # mock 组合 overlay
```

## 5. 关键文件说明

### 5.1 `bin.ts` — 启动器

- 解析产品动词，`--help`/`--version` 本地处理（不联网）。
- 设 `DSH_HOME = DSH_CODE_HOME ?? ~/.dsh-code`（隔离）。
- 项目信任前置检查（`ensureTrusted`），未信任时 TTY 询问 / 非 TTY 需 `--approve`。
- 初始化 profile 后委托 `@deepseek-ai/dsh/lib/bin.js --profile dsh-code [--patch <项目patch>] [--resume <id>]`。
- `-p` 委托上游 `headless` profile。
- `isEntryPoint()` 用 `realpathSync` 解析软链（否则 npm link/软链调用时 `main()` 不执行）。

### 5.2 `plugin.ts` — 核心接线（最重要）

- `export const inject = ['agents', 'agentDefaultModel', 'sessions', 'commands', 'llm', 'credentials', 'settings', 'permissionPresets', 'shell']`。
- 用 `agents.create` / `agents.resume` 创建/恢复 agent，`installModelSelection` 挂 `modelRef`（可变，用于 /model 切换当前模型）。
- `session/event` → `reduceSessionEvent` → `host.render`（16ms 节流）。
- `onSubmit` 分发：`!` shell → `/permission` 选择器 → `/` 命令 → 普通 `agent.followup`。
- 注册 slash 命令：`/model` `/config` `/mcp` `/session` `/fork` `/quit` `/exit`。
- 权限审批：`ctx.on('approval/request')` → `host.askChoice`（Allow once / Reject）。

### 5.3 `host.ts` — TUI 主屏

- `TuiMainScreen` + `ProcessTerminal`。
- 组件树：`transcriptContainer`（转写块）→ `selectorContainer`（内联选择器）→ `status` → `workingContainer`（loading/retry/compaction）→ `editorSlot`（Spacer + editor）→ `footer`（快捷键提示）。
- 渲染：`renderItemBlocks`（用户/工具整块背景、助手 Markdown、思考折叠）+ `renderDraftComponents`（流式）+ `renderShellResultBlocks`（shell 结果块）+ notices。
- 交互：Ctrl+C/D/L/O、Esc 取消 overlay/选择器、`askChoice`/`askText`（overlay）、`showSelector`（内联）。

### 5.4 `reducer.ts` — 纯函数事件折叠

- `reduceSessionEvent(state, event)`：按 `seq` 去重、乱序/缺号 `throw`（fail-fast）、未知 `ignorable` 跳过、未知 required 抛错（升级提示）。
- 处理 `assistant/chunk`（流式 draft）、`assistant/message`（权威落盘）、`tool/call`/`tool/result`（含 diff 提取 + 计时）、`turn/start`/`turn/end`、`approval/asked`/`decided`、`llm/retry`/`retry-started`、`compaction/start`/`end`、`permission/preset`、`plan/mode`、`command/done`、`todo/write`。
- `KNOWN_UNRENDERED_EVENT_TYPES` 集合需与上游 `KNOWN_SESSION_EVENT_TYPES` 手工同步（基线升级时）。

## 6. 构建 / 运行 / 测试

```bash
# 首次 checkout
git submodule update --init --recursive

# 一次性：安装 + 构建上游依赖（submodule 内 host + client 两套 lib）
pnpm install
pnpm run build:lib

# 日常：改完 dsh-code 代码后重编（会自动 chmod +x lib/bin.js）
pnpm run build                # = tsc -p tsconfig.json

# 运行（本地软链到 PATH 里即可当 dsh-code 用）
node lib/bin.js --version
node lib/bin.js -p "任务"
node lib/bin.js          # 交互 TUI（需真终端）
node lib/bin.js -c        # 恢复当前目录最近会话（无则新建）
node lib/bin.js -r        # 会话选择器（Enter 进入 / Esc 退出 / Del 删除）
node lib/bin.js resume <id>   # 恢复指定 id 的会话

# 测试
pnpm test                     # vitest run（tests/**）

# 类型检查
pnpm run typecheck            # tsc -p tsconfig.json --noEmit
```

### 不用真实 key 测模型闭环

```bash
node deepseek-harness/apps/cli/lib/bin.js --profile headless \
  --patch tests/fixtures/mock.cordis.yml "prove the tool path"
# 输出 DSH_CODE round trip complete: DSH_CODE_TOOL_ROUND_TRIP 即通过
```

### 本地软链（开发体验）

```bash
ln -sf "$(pwd)/lib/bin.js" ~/dev/Nodes/node-v22.19.0/bin/dsh-code
```

> 注意：软链目录要选在 PATH 里且可写的（本机 `/usr/local/bin` 不可写，用了 `~/dev/Nodes/node-v22.19.0/bin`）。

## 7. 已实现功能清单

| 能力 | 状态 |
| --- | --- |
| CLI（help/version/resume/-r/--resume/-c/--continue/-p/config/plugin/import/update） | ✅（config/import/update 是 stub） |
| 独立 home、项目信任、profile 初始化、launcher 委托 | ✅ |
| `-p` 单次 prompt（委托 headless） | ✅ |
| TUI：转写、流式、工具卡片、状态栏、编辑器 | ✅ |
| approval overlay（Allow once / Reject） | ✅ |
| 内联选择器（/model、/permission） | ✅ |
| shell mode（`!` 前缀，绿色边框，直接执行） | ✅ |
| session resume（`resume <id>`、`-c` 最近会话、`-r` 全屏选择器，删除二次确认）、fork | ✅ |
| 命令面板（/model /config /mcp /session /fork /quit /exit） | ✅ |
| Markdown 渲染、工具 diff 高亮 | ✅ |
| 思考/工具结果折叠（Ctrl+O）、整块背景、块间距、页脚 | ✅ |
| loading / retry / compaction 状态指示 | ✅ |
| `/` 命令联想 + `@` 文件联想(fd) + `/permission` 参数补全 | ✅ |

## 8. 核心设计模式

### 8.1 事件流

```
上游 session.append() → 'session/event'（scoped 到 session，root 监听器能收到）
  → reduceSessionEvent（纯函数，去重/乱序/折叠）
  → host.render（16ms 节流，重建组件树）
```

### 8.2 颜色 / 主题

`theme.ts` 提供 `paint(open, close)` 生成 ANSI 角色函数；`NO_COLOR` 时退化为恒等。整块背景用 `Text` 的 `customBgFn`（pi-tui 的 `applyBackgroundToLine` 会自动铺满行宽）。颜色值：

- 用户块背景 `#343541`、工具块背景 `#283228`
- 输入框边框 `#ca84db`、shell 边框 `#a6da95`、选择器边框 `#89b4fa`

### 8.3 选择器（model/permission）

`selector.ts` 的 `ListSelectorComponent`（`Container` + `Focusable`）内联挂在 `selectorContainer`，含搜索 `Input` + 列表 + 边框；`handleInput` 处理上下键/Enter/Esc。进入时 `editorSlot.clear()` 隐藏编辑器 + `setFocus(selector)`，退出时恢复 + `setFocus(editor)`。

### 8.4 模型切换

`modelRef`（`ModelSelectionRef`）在 agent 创建时 `installModelSelection` 挂上；`/model` 选择后改 `modelRef.current`（当前 agent 下一轮生效）+ 写 `agent-default-model` 设置（持久化）。

## 9. 上游公开 API 速查

| dsh-code 用的接口 | 来源包 |
| --- | --- |
| `ctx.agents.create/resume`、`Agent.followup/steer/cancel/dispose` | `@deepseek-ai/dsh-agent` |
| `session/event`、`SessionId`、`SessionEvent` | `@deepseek-ai/dsh-session` |
| `createUserMessage`、`TokenUsage` | `@deepseek-ai/dsh-llm` |
| `ctx.commands.list/execute/register` | `@deepseek-ai/dsh-commands` |
| `ctx.approval`（`approval/request` waterfall） | `@deepseek-ai/dsh-user-approval` |
| `ctx.permissionPresets.names/current/set` | `@deepseek-ai/dsh-permission-presets` |
| `ctx.settings.update/replace/get`、`ctx.credentials.set` | `@deepseek-ai/dsh-settings` / `-credentials` |
| `ctx.shell.resolve/run` | `@deepseek-ai/dsh-shell` |
| `ctx.sessions.fork/flush` | `@deepseek-ai/dsh-session` |
| `ctx.llm.listProviders/listModels` | `@deepseek-ai/dsh-llm` |

类型通过 `import type {} from '<包>'` 的 declaration-merge 挂到 `Context` / `SessionEventMap` 上。

## 10. 如何新增一个 slash 命令

1. 在 `plugin.ts` 里 `host` 创建之后 `ctx.commands.register({ name, description, input?, handler })`。
2. handler 返回 `{ kind: 'success' | 'error', text? }`；需要弹选择器就 `host.showSelector(...)`，需要交互就 `host.askChoice/askText`。
3. 结果经 `command/done` 事件被 reducer 渲染为 notice（无需额外处理）。
4. 需要参数补全就加 `getArgumentCompletions`（见 `/permission` 的实现）。

## 11. 已知限制与待办

- `config` / `import dsh` / `update` 三个产品动词是 stub（返回 not implemented）。
- 会话切换（`/session` 只是展示信息；不支持对话内切到别的会话——已按产品决定移除 `/sessions`）。
- `@` 文件联想依赖 `fd` 二进制（未安装时走内置遍历，较慢）。
- `/session` 未展示 Cost（上游无定价表）和完整的 cache 明细（有 cacheRead/cacheWrite/reasoningTokens 字段可补）。
- 尚未做：npm 打包发布（`workspace:*` 依赖需在发布时替换为固定版本）、跨平台 CI、`dsh-code update` 实装。
- 性能：转写是组件树重建（每次 render 清空重建），长会话未做虚拟化（见设计文档 §23 预算）。

## 12. 注意事项 / 踩坑

1. **软链 entry 检测**：`isEntryPoint` 必须 `realpathSync(process.argv[1])`，否则软链/`npm link` 下 `main()` 不执行、命令静默无输出。
2. **构建产物可执行位**：`tsc` 不保留 `bin.js` 的可执行位，build 脚本末尾有 `chmod +x lib/bin.js`。
3. **lint 严格**：`@stylistic(max-len)` 限 140 列，pre-commit 会拦超长行。
4. **Enter 是 `\r` 不是 `\n`**：PTY 自动化测试喂输入时用 `\r`（`\n` 会被当成编辑器换行而非提交）。
5. **`arguments` 是保留字**：TS strict mode 下参数名别用 `arguments`。
6. **model/permission 的 `value` 用 ` ` 分隔 provider 和 model**（避免 model id 里含 `/` 导致 split 错位）。
7. **凭证文件**：`~/.dsh-code/.credentials.yaml` 需 `chmod 600`；key 不得进日志/错误栈/session。
8. **测试从仓库根跑**：`npx vitest run apps/dsh-code/tests`（从 `apps/dsh-code` 子目录跑会找不到测试）。

## 13. 提交与推送约定

- **不要默认 git commit/push**，仅在用户明确要求时执行。
- 提交前自查：`npx vitest run apps/dsh-code/tests` 全绿；lint 不报超长行。
- pre-commit hook（lefthook）会跑 lint / third-party notices / whitespace / vendor guard，失败会拦截提交。

---

*最后更新：2026-08-18，对应 `feat/dsh-code` 分支（含会话选择器 `-r`/`--resume` + 删除二次确认、`-c`/`--continue`、内联选择器 + shell mode）。*
