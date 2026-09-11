# dsh-code 0.1.5 上游升级回归

## 2026-09-11：同步 rc.2

当前上游为 `dsh-v0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203`，产品版本保持 `0.1.5`。相对 rc.1 的实际代码变化集中在 Web 反馈与交付文件展示：正负评价统一打开反馈对话框，反馈分类适用于两类评价，交付文件卡片、文件图标与间距改进。Session/Agent/PTC 接口及持久化格式未改变，无新增下游运行逻辑适配。

本机回归（macOS arm64 / Node 22.19.0）：

- frozen-lockfile 安装、Host/Client 构建、产品 Web/TUI 构建及类型检查通过，锁文件无需变动。
- 下游 35 文件、233 项测试通过。
- 上游 Web 定向测试覆盖 ui-message-feedback、ui-deliverables、code-file-icon、turn-tail-spacing，15 文件、322 项通过。首次运行受本地残留的第二套 React/渲染器和 JSX 默认转换影响；将 `deepseek-harness/node_modules/@testing-library` 移至 `/tmp/dsh-code-rc2-test-deps.Zizp5q/testing-library` 备份并链接根工作区依赖，再通过临时配置继承上游 Vitest 配置、对各 test project 设置 `esbuild: { jsx: 'automatic' }` 后全部通过。未修改上游源码、断言或测试门禁。
- 真实 PTY 恢复隔离会话，发送 `rc2 shell round trip` 完成模型→bash→答复。`/web` 启动随附 Web，Chrome 中点击点赞打开对话框，选择“任务结果”、填写测试备注并提交，页面显示“感谢你的反馈”及已选中状态；发送 `WEB_RC2_RETURN` 完成工具往返。终端 Esc 返回 TUI 后恢复输入，`/quit` 输出包含 Web 新消息、ANSI 样式和 resume 提示，返回码 0。隔离 home 为 `/tmp/dsh-code-rc2.yAAshr/home`，未触碰真实用户会话；测试标签页及服务已关闭。
- 候选包生成、审计、macOS 隔离全局安装、PTC worker、Web 静态资源及独立 `dsh` 共存 smoke 全部通过。`dist/npm/tsingwill-dsh-code-0.1.5.tgz` 为 272936 字节，SHA-256 `94356cca3298ce1e3714094c7479b528427c663ad6ac088fd1060303f5989c02`；231 个 DSH 包固定 `0.1.5-rc.2`，SBOM 565 项，npm audit 0 个已知漏洞。

本轮未执行 Windows / Node 24 发行矩阵，未提交、推送或发布。下文保留 rc.1 升级历史证据。

## 2026-09-10：rc.1 历史记录

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
