# dsh-code 0.1.6 上游同步与回归

日期：2026-09-23。产品开发版本升级到 `0.1.6`，尚未发布。

## 固定版本

- 原上游：`dsh-v0.1.5-rc.2`，`fb2c4b9e698e30edb738bca4cf0618587db7d203`。
- 新上游：`dsh-v0.1.6-alpha.2`，`ddefc45fbc7f8e46dd73185e68295696d1297887`。
- 同步包含中间 `dsh-v0.1.6-alpha.1` 的累积变化，非仅更新版本字符串。
- 上游子模块没有本地源码修改；产品版本、依赖声明与 pnpm lockfile 一并更新。

## 下游适配

1. 上游移除了 `@deepseek-ai/dsh-code-runtime-worker-thread`，改为
   `@deepseek-ai/dsh-ptc-runtime-node`。产品 profile 不再额外挂载旧 worker，直接使用
   dsh-base 已提供的共享 `ptc-runtime` 服务；禁用的 preset-owned workflow 行同步
   从 `workflow-worker-thread` 改为 `workflow-ptc`，避免全局与 Agent preset 重复组装。
2. 运行时调用从 `ctx.codeRuntime.run(request)` 改为
   `ctx.ptcRuntime.run(ctx.ptcRuntime.resolve(request))`。PTC 集成夹具和安装 smoke
   同步更新，断言 TypeScript、进程隔离与真实执行结果 42。
3. 安装 smoke 挂载新运行时要求的 filesystem、subprocess、sandbox、session projection
   与 sandbox policy 服务，退出时释放 Context。该 smoke 在临时 prefix 内使用显式
   full-access 测试策略，只证明安装和运行时可执行，不作为操作系统沙箱隔离验收。
4. 上游 MCP 使用 SDK v2；stdio 每次连接会先启动短生命周期发现子进程，再启动会话
   子进程。热重载测试两次挂载的 stderr banner 精确断言从 2 改为 4，保留工具加载、
   卸载、重新加载断言，没有更改产品 MCP 连接策略。

上游 Agent 创建事件改为串行等待、删除 `agent/session-start`；本产品没有使用被删除
事件，类型检查与启动闭环未要求增加兼容分支。Session 当前持久化版本仍为 v3；已有
fork 持久化及 v2→v3 迁移集成测试通过。上游默认 profile resolution 改为 runtime，
本地产品 profile 启动和随包依赖安装验证通过。

## 验证结果

本地平台：macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm build:lib` | native host addon、host/client 类型与打包通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 35 文件、235 用例通过，无跳过 |
| `pnpm build` | 产品及 Web 构建通过 |
| `node lib/bin.js --version` | `0.1.6` |
| `build-release.mjs --skip-build` | 生成 0.1.6 候选包 |
| `verify-tarball.mjs` | 包内容、依赖固定、SBOM 和既有安全门禁通过；中危项见下文 |
| `smoke-install.mjs --coexist` | 隔离 npm 安装、CLI、Web 静态资源、PTC 结果 42、独立 dsh 共存通过 |

真实 PTY 使用全新临时 product home / project 和无 key mock adapter，未读取真实用户
凭据：Standard 的模型→bash→结果 `DSH_CODE_TOOL_ROUND_TRIP`→最终回答闭环通过；
`/clone` 自动切换并继承历史；`/quit` 返回码 0，保留 ANSI 渲染历史并输出新会话 resume
命令。没有在此次同步中重跑浏览器 GUI 往返、Windows CI 或 Linux 产品实机验收，不将
上述源码/安装检查外推为这些平台的完整验收；Linux 支持范围未改变。

首次构建发现本机旧上游 `node_modules` 中 Vitest 4.1.8 与根 workspace 4.1.10 类型
冲突。已将旧生成目录移至 `/tmp/dsh-code-016-stale.idckPb/node_modules` 备份，使用
根 workspace 依赖重新构建通过，没有修改上游源码或跳过类型检查。host/client 全部
构建完成后才采用最终测试结果，不使用构建中间态的测试输出作为结论。

## 候选包与审计风险

- 文件：`dist/npm/tsingwill-dsh-code-0.1.6.tgz`，273128 bytes。
- SHA-256：`9ac36b2e3dfca2ad850dafbfa8d99390c41995d7b71011c0b237649604b79d58`。
- 250 个 DSH 包固定到 `0.1.6-alpha.2`；SBOM 554 components。
- npm audit：5 moderate、0 high、0 critical。既有门禁只阻断 high/critical，
  “门禁通过”不代表无已知漏洞。
- 这 5 条记录来自同一条新增 Office 预览依赖链：
  `dsh → dsh-web-app → dsh-office-to-pdf → libreoffice-kit → fflate`。
  npm audit 报告 `fflate >=0.8.0 <0.8.3` 的畸形 ZIP64 解析无限循环风险，
  advisory 为 `GHSA-px8p-9vwx-vf98`。本轮未擅自覆盖上游 Office 依赖；发布前应评估
  升级/覆盖方案并重跑 Office 预览与安装验证，不应把该项隐藏为零漏洞。

## 后续检查发现的待修复兼容缺口

上游新增 `image/offload` 持久化事件，但当前 TUI reducer 尚未识别该事件；触发图片
卸载后的实时处理或历史回放存在抛出 `UnknownRequiredEventError` 的风险。上述 235 项
测试没有覆盖这个新增场景，不能据此认定图片会话往返已兼容。发布前需补充事件处理，
并验证图片卸载、恢复会话及 Web 返回 TUI 的回归。本次提交保留该已知缺口，未修复。

升级改动按用户要求提交；不创建发布标签、不推送，也不执行 npm 发布。
