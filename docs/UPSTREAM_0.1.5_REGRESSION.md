# dsh-code 0.1.5 / DSH 0.1.5-rc.1 升级回归

日期：2026-09-10。产品版本 `0.1.5`，上游固定 `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。本轮不提交、推送或发布；上游子模块保持无本地源码修改。

## 分段检查

| 区间 | 重点变化与处理 |
| --- | --- |
| 0.1.3-alpha.2 → 0.1.5-alpha.1 (`5dda764ed3`) | Session 格式 v3：系统提示词进入 `system/message`，PTC 事件由 `tool/code-dispatch*` 改为 `tool/ptc-dispatch*`，预设 `code` 迁移为 `ptc`；Agent setup 显式传入 Agent；原生系统能力迁入 `native/system`。 |
| alpha.1 → alpha.2 (`b2e3b2a012`) | 子 Agent catalog、文件交付与预览、审批及模型配置修正、原生 flock worker 修复；接受新增 `subagent/catalog` / `deliverables/presented` 日志，重建随附 Web 与原生模块。 |
| alpha.2 → rc.1 (`183f08e9c6`) | 新增 `deepseek-flash` / DeepSeek-V41-Flash 模型目录及侧栏预览布局修正；不把 RC 当作仅版本号变化。 |

## 下游适配

- 版本化列表支持 v3，仍读取旧代列表，但恢复时的相邻迁移交给上游；拒绝将未知更高版本当作空会话清理。新增未来版本保护测试。
- TUI 渲染 PTC dispatch 新事件名；系统消息保留在模型历史但不作为普通对话展示，子 Agent catalog 与交付审计事件不触发“未知必需事件”错误。
- setup 使用第二个显式 Agent 参数读取恢复预设，不再依赖已移除的 `ctx.agent`。
- workspace 路径改为 `native/system`，Host 构建前执行上游 `build.ts --host-addon-only`。macOS 编译 `system.node` 用于写锁；Windows 无对应 POSIX addon 时上游脚本安全跳过。停止允许旧 `fs-ext` 的遗留构建。
- 同步上游运行时版本的 release-age 列表。发行审计发现 js-yaml `4.3.1` 命中 GHSA-2883-xcg3-v3hh，将产品依赖最低版本升级为 `4.3.2`，不降低审计门禁。

## 自动化验证

环境为 macOS arm64、Node 22.19.0、pnpm 11.7.0。

- 上游 Host/Client、产品 TUI/Web 构建与下游类型检查通过。
- 下游全量测试 35 文件、233 项通过，含标准/PTC 预设、worker runtime、真实 shell 模型往返、fork 持久化及恢复。
- 上游 `session-format-v2-to-v3/tests` 与 JSONL lease：9 文件、538 项通过。
- 上游 `core/tools/tests/ptc.spec.ts`：91 项通过。
- 上游 `v2-ptc-migration.spec.ts` 在其源码别名测试模式下失败于 Vitest 不支持 `import.meta.resolve`，不是静默跳过。相同测试在构建产物解析模式下通过；新增下游 `tests/integration/v2-ptc-migration.spec.ts` 固定该模式，覆盖真实迁移校验 worker，断言 v2 字节不变、v3 发布、消息标识/角色/正文与回放状态保持。

## 实际交互闭环

使用隔离 home `/tmp/dsh-code-015.5o9bWm/home`，由上一轮测试数据复制，不迁移真实用户 home。

- `-c` 恢复 v2 旧会话，生成 `session.v3.jsonl.zstd`；旧 v2 文件 SHA-1 前后均为 `f1caaf7424bbbced6bba5120f9dd51ea04c25343`。恢复历史含上一轮 Web 消息；继续发送 `v3 tool round trip` 完成 mock 模型→真实 bash→最终答复。
- `/clone`、`/fork` 均落盘并自动切换；列表保留 0–4 深度的五层父子关系。
- `/web` 启动包内上游 Web，终端停留只读状态。Chrome 选择新 fork 会话，发送 `WEB_015_ROUNDTRIP` 并完成工具调用；终端 Esc 停止 Web，TUI 重载同一会话并展示该新消息，恢复输入，无写锁冲突。浏览器测试标签已关闭。
- `/new` 切换到空 Standard，会话未输入即 `/quit` 后保留原有五个会话，无额外空记录；另从 `--mode ptc` 启动确认 PTC 状态，执行 `/new` 后回到 Standard，无预设继承。
- 再次恢复后执行 `!printf SHELL_015_EXIT` 并 `/quit`，返回码 0，退出输出保留 shell 结果、ANSI 格式与 `To resume this session: dsh-code resume …`。

## 发行范围

`pnpm install --frozen-lockfile`、`build-release.mjs --skip-build`、`verify-tarball.mjs`、`smoke-install.mjs --coexist` 均通过。最终候选 `dist/npm/tsingwill-dsh-code-0.1.5.tgz` 大小 272901 字节，SHA-256 为 `904720c2aec3ce79b8da20219e6266ec3c53ef2dcea8b0eaa520df1cb5b8a26b`。231 个 DSH 包精确固定到 `0.1.5-rc.1`，SBOM 565 项；npm audit 为 0 个已知漏洞。macOS 隔离全局安装、CLI、随附 Web 静态资源、PTC worker 和独立 `dsh` 共存验证通过；临时安装前缀已清理。

本轮只验证 macOS arm64 / Node 22.19.0，不代表 Windows / Node 24 的发行矩阵已执行，也不代表 npm 正式版已发布。
