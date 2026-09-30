# TUI 插件管理

`/plugins [搜索词]` 在聊天记录下方打开内联面板，管理当前 `dsh-code` Profile。
插件管理不调用模型；普通模型工具启用后由 Agent 根据对话调用。`/skills` 和 `/mcp`
继续使用各自的管理入口。

## 列表和详情

```text
Plugins · Profile: dsh-code
Changes affect all sessions using this profile.
↑↓ select · Enter details · Space enable/disable · Esc close
> 搜索词
→ ● @example/repo  1.0.0  On · Active
  ○ @example/database  0.8.1  Off · Not selected
  + Install plugin…
  View built-in plugins…
  View current Agent tools…
```

包名仅为示例。默认列出 Profile 自己安装的 Bundle，内置 Bundle 在独立页面中查看。
输入 `/plu` 可补全为 `/plugins`。列表每两秒刷新，保留搜索词和选中项。
Enter 进入详情；Space 请求启停；内置插件页按 Esc 返回已安装列表，已安装列表按 Esc 关闭。
启用状态与运行状态分别展示：选择了 Bundle 不代表其所有插件均已加载。失败、仍在加载、
配置被覆盖和需要重启不会显示成安装完成即可使用。

详情页提供组件、当前 Agent 工具、启停、精确版本更新、卸载及诊断。仅 Profile 自己安装
且上游允许删除的包可更新/卸载。内置 Bundle 可在上游允许时整体启停，内置组件只读；
TUI 入口、preset 注册表等产品组件受保护。preset 内部的子插件不在这里逐个修改。

ACP、Web、headless、SDK 和 SDK-minimal 的应用入口 Bundle 不允许在 TUI Profile 中启用。
它们会接管 argv、stdin 或界面生命周期；例如 ACP 入口会拒绝 TUI 的 `--resume` 参数。
列表仍可查看这些包，但标注为独立应用并隐藏启用操作。启动器也会在会话选择之前检查
Profile 中是否混入这些入口，并给出冲突包名和配置路径。已有错误配置需要从该 Profile
`package.json` 的 `dsh.profile.bundles` 中移除对应入口，保留其他插件和会话数据。

“View current Agent tools” 列出当前 Agent 作用域中注册可见的工具，不推断每个工具来自哪个
Bundle。PTC 模式实际给模型的直接工具是 `run_code`，其他注册工具通过上游 PTC SDK 使用。

## 安装和更新

选择 `Install plugin…`，输入 npm 包规格、绝对路径本地目录、Git URL 或 tarball。
预检展示已知的包名、版本、描述和来源；无法预检完整元数据的来源在安装时验证。
支持安装并启用，或仅安装。已经安装的包从详情页选择 `Update version…`，输入精确版本
（包括预发布版本），确认后更新，保留原启用状态。更新后按上游结果提示重载。

包管理使用上游 pnpm 路径，通常要求 PATH 中有 pnpm。进度显示阶段、耗时和最近四行日志；
不伪造下载百分比。按 Esc 或选择取消操作后，确认是否取消；面板等待进程退出和上游恢复
完成才结束安装状态。已经进入应用配置阶段时可能来不及取消，最终结果仍以上游为准。

安装可能执行 Host 代码。被 pnpm 阻止的构建脚本必须查看具体包名并明确批准后重试；
批准是该 Profile 的持久权限。版本不兼容默认阻止，面板不自动创建兼容豁免。可通过
原有 `dsh-code plugin` 命令处理高级包管理需求。

## 生效、重载和失败

修改要求当前 Agent 空闲，且没有压缩、排队消息、运行中的 shell/后台任务或活跃子代理。
操作期间不启动新的用户回合或切换/退出会话，输入草稿保留。浏览操作不改变 Profile。
这些拦截只覆盖当前 TUI；同 Profile 的其他进程不会被本面板自动暂停。

上游返回值分别显示为已应用、需要重载、被更高优先级配置覆盖、失败或已取消。需要重载时
可以立即处理或稍后从列表重载；重载通过已有 launcher handoff 恢复当前 Session，保留
对话历史。已有 Agent 不会因 preset 定义变更自动更换组合，需重建运行实例验证新行为。

诊断展示操作阶段、保存状态是否变化、错误、警告及包管理输出。日志按页查看，最多读取
日志文件最后 64 KiB，并显示完整文件路径。安装失败/取消使用上游恢复规则；卸载失败可能
已经禁用了 Bundle，不声称全部回滚。插件执行和构建脚本的外部副作用也不保证恢复。

## 存储和兼容范围

默认目录为 `~/.dsh-code/profiles/dsh-code`，可随 `DSH_CODE_HOME` 改变。上游维护
`package.json` 的依赖与 `dsh.profile.bundles`、`cordis.patch.yml`、pnpm 锁文件和构建权限。
TUI 启动时保留这些用户依赖和覆盖，不另外创建插件数据库。

| 入口 | Profile |
| --- | --- |
| TUI `/plugins`、`dsh-code plugin` | `dsh-code` |
| `dsh-code -p` | `headless` |
| `/web` | `web` |

三个 Profile 的插件选择独立。插件管理不会导入独立 DSH 或其他产品的插件配置。
普通 Host/工具 Bundle 可以通过上游扩展；Web 专属界面、自定义 preset、引入未知必需
Session 事件的插件需要专门适配。当前支持的 Agent preset 仍为 Standard/PTC。
人工管理不改变当前权限模式，也不会默认给模型开启 `plugin_manager` 工具。

## 开发验证

- `tests/unit/plugin-manager.spec.ts` 覆盖页面导航、迟到预检、安装取消、脚本审批、更新保留
  启用状态、运行中拦截、产品组件保护及部分失败展示。
- `tests/integration/plugin-panel.spec.ts` 通过真实 DSH Profile 和 Loader，用临时本地包
  驱动产品面板安装、启停、重启后保留及卸载，并观察实际 Agent 工具集。
- `tests/unit/selector.spec.ts`、`tests/unit/host.spec.ts` 保留现有选择器及终端交互回归。

2026-09-30 本地验收环境为 macOS arm64 / Node 22.19.0：类型检查、产品及 Web 构建通过，
全量测试 39 文件、266 用例通过。真实 PTY 覆盖 80×24 列表/详情、本地安装、启停、卸载、
40×18 缩放与正常退出；关闭 HMR 后另行验证重载提示、恢复同一 Session、插件加载及继续
工具调用。安装取消和脚本批准通过可控制的异步服务测试覆盖；未将本机结果视为 Windows/
Linux 实机或公网 npm/Git 下载验收。

会话恢复修复另有 `tests/integration/resume-profile.spec.ts`：在隔离 Profile 中重现 ACP
入口拒绝 `--resume`，确认移除冲突后参数仍由上游完整传递。相关 6 文件、48 用例通过；
真实 PTY 验证 `-r`、`--resume`、`resume`、`resume <id>` 和 `-c` 均恢复同一 Session，
并能继续完成工具调用。独立应用 Bundle 的启用拦截覆盖 ACP、Web、headless、SDK、
SDK-minimal。
