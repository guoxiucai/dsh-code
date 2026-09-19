# Linux 兼容性验证

验证日期：2026-09-19。产品版本：`@tsingwill/dsh-code@0.1.5`。
上游固定为 `dsh-v0.1.5-rc.2`（`fb2c4b9e698e30edb738bca4cf0618587db7d203`）。

Ubuntu 实机 npm 安装与交互验收步骤见 [面向 Code Agent 的验证手册](UBUNTU_AGENT_VALIDATION_GUIDE.md)。

## 结论与边界

**当前版本不支持 Linux 产品运行。Linux 上的源码构建、自动测试成功，不等于 npm 安装后的 CLI/TUI 已通过验收。**

- `src/cli/platform.ts` 仅接受 `darwin-arm64` 和 `win32-x64`。
- `src/bin.ts` 在实际启动、恢复会话等操作之前检查平台；Linux 返回退出码 1 和 unsupported platform 信息。`--help`、`--version` 不经过这项保护，因此它们成功不能证明产品可运行。
- `scripts/smoke-install.mjs` 同样拒绝 Linux；CI / Release 的安装验证矩阵只有 macOS / Windows，Node 22.19 / 24。
- `src/tui/clipboard.ts` 没有 Linux 剪贴板后端，返回不支持。仅移除入口保护也不足以宣告完整支持。

本轮不修改产品支持范围、不绕过入口保护，也不发布新版本。

## 验证环境与证据

本地操作环境是 macOS arm64，没有可直接使用的 Linux shell 或本地容器运行时。Linux 验证使用项目已有的 GitHub Actions Ubuntu 24.04 x64 runner，而非本机模拟 `process.platform`。

验证源码：`6afd8d54128de64198b4d6b11329f9a08d231edc`。
[CI run 35428707686](https://github.com/guoxiucai/dsh-code/actions/runs/35428707686) 的 candidate job 使用 Node 22.19.0。

本轮重新运行（attempt 2）的 [Ubuntu candidate job](https://github.com/guoxiucai/dsh-code/actions/runs/35428707686/job/105860622492) 全部成功，与原始运行（attempt 1）结果一致。日志确认：

| 项目 | 结果及含义 |
| --- | --- |
| frozen-lockfile 安装 | 通过，Linux 开发依赖可安装 |
| 上游 native host addon、host/client 构建 | 通过，不代表已安装产品的原生依赖全部验收 |
| 产品 typecheck | 通过 |
| 自动测试 | 34 文件通过、1 文件跳过；232 用例通过、1 用例跳过 |
| Standard / PTC preset | 通过上游入口组装测试，PTC worker 返回 42 |
| Mock 模型 → bash → 最终响应 | 通过真实子进程闭环，无需真实模型凭据 |
| 会话 fork 持久化、v2→v3 PTC 迁移 | 集成测试通过 |
| MCP stdio 动态加载/卸载 | 集成测试通过 |
| 产品与 Web 构建、候选 npm 包审计 | 通过，audit 为 0 known vulnerabilities |
| Linux clean npm install、产品 TUI | 未覆盖，不应标记为通过 |

本轮候选包为 `0.0.0-ci.44`，SHA-256：`9d45ed059e75aa891462db20aa98eaa6563b6a97ede436a96d629a799a5772a3`。它是 CI 验证产物，不是重新发布的 npm 0.1.5 包。

本轮 CI 最终结论为 **success**：Ubuntu candidate 与随后的 macOS arm64 / Windows x64、Node 22.19 / 24 四组安装 smoke 全部通过；Node 22.19 两组还包含独立 `dsh` 共存验证。后四组是现有受支持平台的回归，不是 Linux 安装证据。

跳过项为 `tests/integration/node-warning-filter.spec.ts`：测试前只执行了上游 `build:lib`，干净 checkout 中尚无产品 `lib/bootstrap/node-warning-filter.js`；产品构建在打包步骤才执行。这不是 Linux 功能失败，也不是该项验证通过。

Mock 工具闭环入口是上游 `deepseek-harness/apps/cli/lib/bin.js`，不是产品 `dsh-code` launcher。该测试显式设置 `DSH_PERMISSION_MODE=danger-full-access`，只验证临时测试目录中的模型/工具链路，**未验证 workspace-write 或 read-only 的 Linux 沙箱隔离**。不能以该测试作为建议用户关闭沙箱的依据。

本轮补充了 Linux x64 / arm64 的平台拒绝回归断言（`tests/unit/platform.spec.ts`），本地 4 用例通过。这是平台策略测试，不是 Linux 实机运行证据；该未提交改动也不包含在远端上述提交的测试计数中。

包含新断言的本地 macOS 回归：`pnpm typecheck` 通过；`pnpm test` 为 35 文件、235 用例全部通过。与远端数量不同的原因是增加了 2 条平台断言，且本地已有构建产物，因此 warning-filter 用例没有跳过。

## 后续若增加 Linux 正式支持

建议先限定 Ubuntu 24.04 x64、Node 22.19 / 24；arm64、Alpine/musl、其他发行版单独验证，不外推支持。

1. 扩展平台策略、安装 smoke 与 CI/Release 矩阵；从同一个候选 tarball 在干净 Linux 环境安装，检查原生依赖与独立 `dsh` 共存。
2. 在真实 PTY 中验证启动、流式输出、`!` shell、resize、Ctrl-C、`/quit` 的格式化历史和 resume 提示。
3. 验证 `/new` Standard 默认值及空会话清理、`/resume`、`/fork`、`/clone` 层级与持久化，以及 PTC 执行。
4. 分别验证有桌面浏览器和无桌面/SSH 环境的 `/web` 地址提示、服务启动、返回 TUI 后的会话刷新；不能把浏览器标签关闭等同于 Web 服务退出。
5. 在具备所需内核能力的环境验证真实沙箱的允许/拒绝行为；不可用时验证清晰报错，而不是静默降级为 full-access。
6. 明确 Linux 剪贴板支持或降级行为；在产品构建后补跑依赖产物的测试，避免跳过项被误计为通过。

完成这些验收后，再更新 README 支持矩阵和发布声明。拥有 Mac/Windows 不妨碍使用 Ubuntu CI 做自动化验证，但无头 CI 不能替代所有桌面终端和默认浏览器的视觉验收。
