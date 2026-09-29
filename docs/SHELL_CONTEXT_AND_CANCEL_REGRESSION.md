# Shell 上下文与首输出前取消回归

验证日期：2026-09-28。基于当前 dsh-code 0.1.6 开发版本；2026-09-29 用户验收通过并要求提交，未推送或发布。

## 行为

- `!command`：由用户直接执行，不请求模型执行命令，也不自动触发模型回答。结果作为
  `source.plugin = dsh-code/user-shell` 的上游 `user/message` 加入 Session surface，
  后续模型请求可以看到；结果持久化，恢复、克隆及 Markdown 导出可见。
- `!!command`：执行方式相同，但结果仅在当前终端显示，不进入 Session 或模型上下文。
  与 pi 的“保存但排除上下文”实现不同，本次双叹号采用临时显示；用户要求恢复的是 `!`
  结果，没有新增下游私有持久化事件或修改上游 Session 格式。
- 结果包含命令、输出、非零退出/信号/超时/取消状态。截断时保留说明和上游提供的完整
  输出文件路径。JSON 编码保留任意输出分隔符；TUI 解码成 shell 卡片，不伪造 Agent
  `tool/call` / `tool/result`。
- 仅有 `!` 的会话不再被空会话清理删除，恢复列表可显示 `!command` 标题，允许克隆。
- 为避免插入正在进行的 Agent 工具调用/结果对之间，忙碌时提交的 shell 等到 Agent
  空闲再执行，并通过公开 `runMaintenance` 持有执行阶段。Shell 待完成时新的提交保留
  在输入框，提示等待或 Esc 取消；`/quit`、`/exit` 可正常处理退出。
- Esc 使用实时执行状态，不再依赖最多延迟 33ms 的渲染快照。取消调用不再以
  `agent.status === running` 为前提：上游取消 API 还负责清除队列、取消准备/维护工作。
  内联选择器与交互审批仍优先处理自己的 Esc。Shell 同样接收 abort 信号。

参考 pi：`packages/coding-agent/src/core/agent-session.ts` 的 `executeBash` /
`recordBashResult`，及 interactive-mode 中 `!` / `!!` 的前缀分流。采用其“执行不等于
唤醒模型”“区分上下文”“避免打断工具顺序”的逻辑，通过 DSH 公共 API 落地。

## 自动回归

- `pnpm build`：通过（含 Web 构建）。
- `pnpm typecheck`：通过。
- `pnpm test`：36 文件、243 用例通过。
- 新增覆盖：`!` / `!!` 前缀、JSON/中文/多行结果、失败/超时/取消/截断描述、无 human
  prompt 的会话保留、zstd 持久化与恢复、恢复列表标题、模型 surface、shell 卡片、
  Markdown 导出、首次 running 渲染前的实时 Esc 分发。
- `git diff --check`：通过。

## 实际 PTY 验证

测试目录：`/Users/qingwei/dev/Harmony/OpenHarmony/south/MissionManager`。
使用隔离 `DSH_CODE_HOME=/tmp/dsh-code-928.h6HduZ/home`，执行前后该项目
`git status --short` 均为空。只运行 `ls`、`printf`、`sleep` 等无项目写入命令。

使用 `tests/fixtures/interactive-regression-adapter.mjs`，不读取真实用户凭据、不产生
外部模型费用。该 fixture 读取真实模型请求消息，报告标记是否存在；收到
`SLOW_PRETOKEN` 时等待 15 秒且不发送任何 chunk，abort 时写 trace 并抛 AbortError。
这验证的是产品 TUI→Agent→适配器取消链路，不冒充真实服务商网络故障验收。

| 场景 | 结果 |
| --- | --- |
| `!printf SHELL_INCLUDED_928`、`!!printf SHELL_EXCLUDED_928` 后提问 | 两者终端可见；模型报告 `CONTEXT included=true excluded=false` |
| `/quit` 后用实际 ID 恢复并再提问 | `!` 卡片恢复，`!!` 不恢复；模型仍报告 included=true / excluded=false |
| 只有 Working、尚无任何模型 chunk 时 Esc | trace 出现 `stream-abort`，TUI 显示 turn cancelled |
| 提交后立即发送 Esc，重复三次 | 三次均取消，不等待 15 秒计时结束 |
| 取消后继续对话 | 正常获得响应，无自动重跑被取消的提示词 |
| 仅执行 `!ls` 的会话 | 保留并显示 `!ls` 标题，不出现空会话丢失 |
| `!sh -c 'printf STDERR_TEST >&2; exit 7'` | stderr 与 exit 7 显示、持久化 |
| `!sleep 10` 后 Esc | 及时取消，结果显示 aborted |
| shell-only 会话 `/clone`、退出 | 自动切换，shell 结果与失败/取消状态保留，退出带 resume 命令 |

验证会话：

- 上下文/取消：`session-66e00778-2f44-4b21-b497-c02b14fd40fb`。
- shell-only：`session-5c0f56e4-d153-4a22-a85a-0d26d3ad6886`。
- clone：`session-c2ac5791-03c0-4c6d-8e74-6463bd1f4def`。

如需复验，先构建产品，再在全新临时 home 的 `cordis.patch.yml` 中插入上述 fixture
的绝对 file URL，并将 `agent-default-model` 配置为 `provider: mock, model: mock`。
可设置 `DSH_CODE_TEST_TRACE` 到临时日志文件；初次凭据引导按 Esc 跳过。使用真实 PTY
运行产品，按表中顺序操作。不要把这些测试配置写入用户真实 home 或项目。

本轮没有重跑 Windows/Linux 实机或浏览器 GUI；不把本机结果外推为全平台视觉验收。
