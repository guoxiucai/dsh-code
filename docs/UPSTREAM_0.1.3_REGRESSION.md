# dsh-code 0.1.3 上游升级回归

## 2026-09-08：同步 alpha.2

当前基线为 `dsh-v0.1.3-alpha.2` / `82a5fd61a7cf5c293cec4bdff68f455398d685e9`，产品版本仍为 `0.1.3`。以下 alpha.1 记录作为历史证据保留。

此次适配新增的 `feedback/message-put` / `feedback/message-delete` 日志事件，防止 Web 反馈会话恢复时触发未知必需事件错误；模型适配依赖从 `pi-ai 0.84.2` 同步到上游使用的 `0.85.1`（TUI 库仍为 `0.84.2`）；补齐新的 `deepseek-harness/benchmarks` workspace，供 Host 构建解析其 Playwright 类型依赖。Session 的 `seedSource` 改为 `eventState`，下游不直接使用该恢复接口，由上游 Agent 恢复链路处理；持久化 `read()` 返回值改为 `{ events, eventState }`，fork 集成测试同步验证新的读取结果及冻结状态。

上游定向回归：消息反馈、JSONL generation/lease 共 4 文件 123 项通过；pi-ai 兼容升级测试 1 文件 21 项通过。2026-09-08 npm 已能查询 `@deepseek-ai/dsh@0.1.3-alpha.2`，上一轮 registry 缺包阻断不适用于当前标签。

`pnpm install --frozen-lockfile`、`pnpm run build:lib`、`pnpm typecheck`、`pnpm build` 通过；下游 `pnpm test` 共 34 文件 229 项通过，包括真实 shell 工具往返和 fork 持久化/写锁交接。

真实 PTY 使用上一轮隔离 home 恢复含 Web 新消息的会话，发送 `alpha2 round trip` 完成模型→bash→最终答复；`/quit` 返回码为 0，终端保留 ANSI 样式历史及 resume 提示。本轮未重复浏览器交互验收，alpha.1 的浏览器证据不等同于 alpha.2 浏览器验收。

发行候选验证：`node scripts/build-release.mjs --skip-build`、`node scripts/verify-tarball.mjs`、`node scripts/smoke-install.mjs --coexist` 均通过。候选包 `dist/npm/tsingwill-dsh-code-0.1.3.tgz` 为 274987 字节，SHA-256 `f98886842c168c0533d9c49a201e21dcca6876900309b04759c35d5a6e54efc3`；223 个 DSH 运行包固定到 `0.1.3-alpha.2`，shrinkwrap 中 pi-ai 为 `0.85.1`，SBOM 580 项，npm audit 为 0 个已知漏洞。macOS arm64 / Node 22.19.0 隔离全局安装、CLI、Web 静态产物、PTC worker 与独立 `dsh` 共存 smoke 通过，临时安装前缀已清理。Windows/Node 24 发行矩阵未在本轮执行。没有提交、推送或发布。

## 2026-09-07：alpha.1 历史记录

日期：2026-09-07。产品版本 `0.1.3`（未发布），上游标签 `dsh-v0.1.3-alpha.1`，提交 `d347e703908d0406b7a7ef80e3a0e594d86b2215`。上游子模块不包含本地源码修改。

## 适配内容

- Session 格式升级到 v2，历史读取由上游负责相邻版本迁移。启动器只读列表选择最大的规范版本文件（`session.v2.jsonl[.zstd]`），保留旧版未带版本文件的读取，忽略临时文件和非规范名称，不回退到旧代日志。不可读/未来格式以及纯附件消息不能被 Web 空会话清理误删。
- 持久化 `assistant/chunk` 已移除。TUI 改为监听 `agent/assistant-stream` 的 start/chunk/end，只更新临时草稿，不消耗 Session seq、不触发 token surface 测量。`assistant/message` 为最终正文，`assistant/attempt` 清理失败预览；新增审计事件按已知不展示事件处理。
- 上游不再自动持久化脱离 Agent 生命周期创建的 Session。fork/clone 子会话改为显式 `SessionPersistence.create → append → flush → close`，写入继承切点和父会话信息，释放写锁后再通知启动器切换。真实回归曾发现旧流程报 `session not found`，补充了落盘与重新获取写句柄的集成测试。
- 上游跨进程 Session 写锁引入 `fs-ext`；workspace 明确允许它的原生构建。Web/附件等其余接口由随附的上游 Host/Client/Web 构建提供，本次未重写上游实现。

## 已执行回归

环境：macOS arm64、Node 22.19.0、pnpm 11.7.0；全部使用隔离临时 home 和 mock 模型，不迁移真实用户数据。

- `pnpm install --frozen-lockfile`、`pnpm run build:lib`、`pnpm typecheck`、`pnpm build`。
- 下游 `pnpm test`：34 个文件、227 项通过，包含 headless mock 模型→真实 shell 工具→模型答复，新增 fork 持久化、流式草稿生命周期及版本化会话列表测试。
- 上游定向测试：`session-persistence-jsonl/tests/generation.spec.ts`、`lease.spec.ts`、`session-format-v0-to-v1/tests`、`session-format-v1-to-v2/tests`，10 个文件、307 项通过。
- 真实 PTY：新对话工具往返；fork 自动切换并可继续对话；clone 自动切换；`/resume` 选择页展示三层树并切换；`/new` 切换到空 Standard 会话，无输入退出后只保留原有三个会话。
- Chrome：`/web` 打开随附 Web，TUI 停留只读状态；选择克隆会话并发送 `WEB_013_RETURN_MARKER`，完成工具调用；终端 Esc 停止 Web 后重新加载同一会话，显示该新消息并恢复输入，无写锁冲突。测试标签页与 Web 进程已关闭。
- 旧版 rc.1 会话副本恢复：生成 `session.v2.jsonl.zstd`，旧 `session.jsonl.zstd` SHA-1 前后均为 `68af231bb6483944906ce67a725e30cb51edbb2c`；可继续 shell 与模型对话。退出输出包含 ANSI 格式、shell 结果、后续消息和 `To resume this session: dsh-code resume …`。
- `node lib/bin.js --version` 输出 `0.1.3`。

升级时旧版本已删除的 `session-persistence-sqlite` 目录只剩本地 `lib/node_modules`，被 tsdown workspace 扫描导致缺失导出错误。已将该残留移至 `/tmp/dsh-code-retired-build.uzverj/` 备份后重建成功；不是修改上游源码来绕过错误。

## 尚未完成的发行验证

`npm view @deepseek-ai/dsh@0.1.3-alpha.1 version --json` 返回 E404；`node scripts/build-release.mjs --skip-build` 在生成 shrinkwrap 时返回 ETARGET（上游指定版本不存在）。因此没有生成可验收的 0.1.3 tarball，没有执行该版本 npm clean global install、Windows/Node 24 发行矩阵，也没有提交、推送或发布。本地源码闭环与 npm 发行闭环分别记录；待上游运行时依赖闭包发布后再执行 release:pack/verify/smoke。
