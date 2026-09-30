# dsh-code 0.2.0 上游同步与 TUI 回归

日期：2026-09-30。产品开发版本为 `0.2.0`；本记录对应本地升级验证，尚未发布。

## 固定版本

- 原上游：`dsh-v0.1.7-rc.2`，`477b4f420553e8a52c2fbccc464d7561b239c443`。
- 新上游：`dsh-v0.2.0-rc.2`，`639ed015397290b3745d163aafe02ffee4aa3f84`。
- 包含 `dsh-v0.2.0-rc.1` 的累积变化；子模块只更新提交，无本地源码改动。

## 阶段影响和下游处理

| 阶段/变化 | 对 dsh-code 的影响与处理 |
| --- | --- |
| 0.1.7-rc.2 → 0.2.0-rc.1：失败步骤补齐工具结果 | 上游在 step 结束前补写 `TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED`。原 TUI 只更新已有 tool/call 卡片，会漏掉尚未开始的工具。本轮暂存已提交的 assistant 工具请求，在结果到达但没有开始记录时创建结果卡片，不标记执行过，不生成开始时间或耗时。已开始的调用更新原卡片，不重复显示。 |
| 同阶段：会话恢复和 WebKit 原生构造器识别修复 | Session writer 仍为 v4，无新增格式迁移。继续使用上游读取/恢复实现；v3 迁移、fork/resume 和 shell 持久化测试保留。 |
| 同阶段：Schedule 移到可选 bundle | TUI 默认不启用 Schedule。曾手动启用 Web profile 中 schedule/time-context/ui-schedule 的用户需启用“自动化任务”bundle，任务文件保留；本轮不自动改写用户 Web profile。 |
| 同阶段：共享 OTel、会话日志上传设置、Desktop 产品统计 | 启动器继续设置 `DSH_TELEMETRY_DISABLED=1`；新增 Desktop 统计行只对 desktop profile 生效，TUI 不挂载这些行。没有因同步默认开启遥测。 |
| rc.1 → rc.2：pi-ai 0.87.1 | 更新根 override、安装时间豁免、workspace patch 与 lockfile，跟随上游模型目录、Mistral 兼容字段及 Anthropic 历史模型标识处理。pi-tui 仍为 0.84.2。 |
| rc.1 → rc.2：可选超时问答及迟到回答 | 上游新增 `mode: timed`、timeout、继续后的回答投影和 steering。Standard/PTC 仍采用默认 legacy 工具定义，本轮用真实预设组装断言其 schema 不含 timed 参数。保留现有问答/计划审批面板，不新增超时、默认回答或迟到回答管理界面。 |
| 两阶段：Windows 文件权限诊断、PowerShell/PTY 收尾修复 | 由上游 sandbox/shell 实现承接；不修改 dsh-code 权限策略。Windows 专属行为未在本机实测。 |
| Web/桌面 UI 变化 | 模型搜索、长会话渲染、动画、设置和插件管理随上游更新；不移植 Web 展示状态或 Desktop CLI 注册机制到 TUI。 |

Koffi 的直接消费者随上游固定到经其验证的版本；pnpm patches 作用于 workspace，npm
候选包使用发布包的精确依赖与 shrinkwrap，不把 pnpm patches 描述成 npm 自动应用的补丁。

## 兼容边界

- 合法顺序的已有 Session v4 不需要格式升级。
- 0.1.6 的 shell-first 旧日志限制仍存在：在首条系统消息之前直接保存 shell 上下文的
  日志不能直接继续，原日志保留，需新会话或单独迁移修复；详见
  [0.1.7 历史日志说明](UPSTREAM_0.1.7_REGRESSION.md#历史日志兼容边界)。
- 超时问答是上游的可选功能。本轮没有为 TUI 增加已超时问题的重新打开/迟到回答入口；
  自定义启用 timed 模式不能视为已完成其全部 TUI 交互支持。
- Schedule 的用户迁移步骤见上游
  [升级指南](../deepseek-harness/docs/upgrade-guide/v0.1.7-rc.2/schedule-optional-bundle/guide.zh.md)。

## 本地验证

环境：macOS arm64 / Node 22.19.0。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm run build:lib` | 原生 addon、host/client 构建通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 产品及 Web 构建通过 |
| `pnpm test` | 37 文件、252 用例通过，无跳过 |
| `node lib/bin.js --version` | `0.2.0` |
| 真实 PTY | 工具闭环、clone/resume、shell-only 克隆与恢复、上下文与 Esc 取消通过 |
| `build-release.mjs --skip-build` / `verify-tarball.mjs` | 候选包生成与审计通过 |
| `smoke-install.mjs --coexist` | 隔离安装、CLI、预设 YAML、Web 静态资源、PTC 结果 42、独立 dsh 共存通过 |
| `git diff --check` | 通过 |

新增回归调用上游真实 `ToolCallRecovery` 生成恢复结果，覆盖已开始/未开始两种状态、
不重复卡片、无虚构耗时、实时与回放一致及待处理请求清理。预设组装检查 Standard/PTC
默认仍为阻塞问答；原有模型配置跨进程保存、会话迁移、PTC 和 MCP 回归通过。
PTY 使用隔离临时 home/project 与本地 mock adapter，不读取真实凭据；验证 `!` 结果
进入模型上下文、`!!` 不进入，首输出前与 shell 执行时的 Esc 取消，以及恢复后首次提问。
安装 smoke 新增从实际 npm 安装目录初始化 Standard/PTC profile，检查发布包的 YAML
exports 与依赖解析，而不借用 workspace 安装。

本次不把 macOS 本地验证等同于 Windows/Linux 实机或浏览器 GUI 验收，也未运行
外部模型的付费 API 测试。

## 候选包与审计

- 文件：`dist/npm/tsingwill-dsh-code-0.2.0.tgz`，285629 bytes。
- SHA-256：`41c66bc6d133b5b20cb94b88947ddbe76727af82b3461091666bea8478be6ef7`。
- 278 个 DSH 包固定到 `0.2.0-rc.2`，CycloneDX SBOM 共 603 components。
- npm audit：8 moderate、0 high、0 critical。仍是 Office/LibreOffice 依赖链的
  fflate 畸形 ZIP64 解析问题（`GHSA-px8p-9vwx-vf98`），没有在此次同步中替换
  上游 Office 依赖。通过 high/critical 门禁不代表零漏洞。
