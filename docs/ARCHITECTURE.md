# dsh-code 整体架构

本文基于 CodeGraph 对当前仓库的索引结果绘制。图中蓝色部分是 `dsh-code`
自身负责的产品层，紫色部分来自固定版本的 DeepSeek Harness；两者通过公开的
Cordis 服务、`AgentHandle` 和 `session/event` 边界协作。

```mermaid
flowchart TB
  User["用户 / 终端"]
  ModelAPI["模型服务<br/>DeepSeek / OpenAI / Anthropic 等"]
  Workspace["项目工作区 / Git / 文件系统"]
  ExternalMCP["外部 MCP Server"]

  subgraph Product["dsh-code 产品层"]
    direction TB
    CLI["CLI 入口<br/>src/bin.ts"]
    Bootstrap["启动治理<br/>参数解析 · 平台检查 · Home 隔离<br/>项目信任 · 凭据引导 · 会话选择"]
    Delegate["启动委托<br/>src/cli/delegate.ts"]

    subgraph Terminal["交互式终端宿主"]
      Plugin["TUI 控制器<br/>src/tui/plugin.ts"]
      TuiHost["终端渲染与输入<br/>TuiHost + pi-tui"]
      Projection["事件投影<br/>Reducer → ViewModel"]
      SubagentProjection["活跃子 Agent 投影<br/>一份快照 → 数量 / 列表 / 切换拦截"]
      McpManager["MCP 配置与热加载<br/>McpRuntimeManager"]
    end
  end

  subgraph Boot["上游启动与组合"]
    Launcher["@deepseek-ai/dsh Launcher<br/>Cordis 插件树装配 / 生命周期"]
    TuiProfile["dsh-code Profile<br/>@deepseek-ai/dsh-base + 产品 Patch"]
    HeadlessProfile["headless Profile<br/>单提示词执行"]
    Preset["Agent Preset<br/>Standard / PTC"]
  end

  subgraph Core["DeepSeek Harness 核心运行时"]
    PublicAPI["公开服务边界<br/>agents · sessions · commands · settings<br/>permissions · skills · jobs · goals"]
    Registry["AgentRegistry / Agent 工厂"]
    AgentLoop["Agent Loop<br/>Turn / Step / Inbox / Cancel"]
    Session["Session 事件日志<br/>唯一事实源"]
    Prompt["上下文与系统提示组装<br/>History · Instructions · Skills · Tools"]
    LLM["LLM Service / Model Adapter<br/>流式请求与响应组装"]
    ToolRuntime["Tool Registry / ToolRuntime<br/>参数校验 · 并发调度 · 结果回填"]

    subgraph Capabilities["能力插件"]
      Builtin["文件 / 搜索 / 编辑 / Shell"]
      Guard["权限 / Sandbox / Approval"]
      MCP["MCP Tools"]
      Runtime["PTC Code Runtime / Workflow"]
      Features["Plan · Todo · Goal · Skills<br/>Jobs · Sub-Agent · Compaction"]
    end
  end

  subgraph State["本地状态"]
    UserState["~/.dsh-code<br/>profiles · settings · credentials"]
    SessionStore["按项目分组的 JSONL 会话<br/>追加写入 / 恢复 / 查询"]
    ProjectState["项目配置<br/>.dsh-code/cordis.patch.yml<br/>MCP 配置"]
  end

  User --> CLI
  CLI --> Bootstrap
  Bootstrap --> Delegate
  Delegate --> Launcher
  Launcher -->|"交互模式"| TuiProfile
  Launcher -->|"-p 提示词"| HeadlessProfile
  TuiProfile --> Plugin
  TuiProfile --> Preset
  HeadlessProfile --> Registry
  Preset --> Registry

  Plugin --> TuiHost
  TuiHost -->|"普通输入 / 命令 / 中断"| Plugin
  Plugin -->|"followup / steer / cancel / dispose"| PublicAPI
  PublicAPI --> Registry
  Registry --> AgentLoop

  AgentLoop -->|"追加结构化事件"| Session
  AgentLoop --> Prompt
  Prompt --> LLM
  LLM --> ModelAPI
  ModelAPI -->|"文本流 / reasoning / tool-call"| LLM
  LLM --> AgentLoop
  AgentLoop -->|"执行 tool-call"| ToolRuntime
  ToolRuntime --> Builtin
  ToolRuntime --> Guard
  ToolRuntime --> MCP
  ToolRuntime --> Runtime
  ToolRuntime --> Features
  Builtin --> Workspace
  Guard --> Workspace
  MCP --> ExternalMCP
  Runtime --> Workspace
  ToolRuntime -->|"tool result"| AgentLoop

  Session --> SessionStore
  Session -->|"session/event"| Plugin
  Plugin --> Projection
  Projection --> TuiHost
  Features -->|"start / end + 后代描述"| SubagentProjection
  Plugin -->|"dismiss"| SubagentProjection
  SubagentProjection -->|"count + rows"| Plugin
  Plugin --> McpManager
  McpManager --> MCP

  UserState -.-> Bootstrap
  UserState -.-> Launcher
  ProjectState -.-> Bootstrap
  ProjectState -.-> Launcher

  classDef product fill:#dbeafe,stroke:#2563eb,color:#172554
  classDef upstream fill:#ede9fe,stroke:#7c3aed,color:#2e1065
  classDef external fill:#f8fafc,stroke:#64748b,color:#0f172a
  classDef state fill:#dcfce7,stroke:#16a34a,color:#052e16

  class CLI,Bootstrap,Delegate,Plugin,TuiHost,Projection,SubagentProjection,McpManager product
  class Launcher,TuiProfile,HeadlessProfile,Preset,PublicAPI,Registry,AgentLoop,Session,Prompt,LLM,ToolRuntime,Builtin,Guard,MCP,Runtime,Features upstream
  class User,ModelAPI,Workspace,ExternalMCP external
  class UserState,SessionStore,ProjectState state
```

## 关键调用链

1. `src/bin.ts` 只处理产品级职责：命令行参数、平台检查、独立 Home、项目
   信任、Profile 初始化和会话选择；随后由 `src/cli/delegate.ts` 启动上游
   `@deepseek-ai/dsh`。
2. 交互模式加载 `dsh-code` Profile。该 Profile 以 `dsh-base` 为基础，挂载
   Standard/PTC Preset、PTC Worker Runtime、兼容 Skills、Ask User 和 TUI 插件。
   `-p` 模式则直接使用上游 `headless` Profile。
3. `src/tui/plugin.ts` 创建或恢复 Agent，通过公开 `AgentHandle` 发送输入，不
   导入 Agent Loop 内部实现。`TuiHost` 负责终端输入输出，Reducer 把结构化
   `session/event` 投影成可渲染状态。
4. Agent Loop 以 Turn/Step 驱动：组装历史、系统提示、Skills 和工具 Schema，
   调用模型适配器；若模型返回 Tool Call，则交给 Tool Runtime 执行并把结果
   加回下一 Step，直到本轮完成。
5. Session 是运行状态的唯一事实源。事件一边推送给 TUI，一边由上游持久化
   服务追加到项目分组的 JSONL 日志，因此恢复、会话树、统计和导出都基于同一
   份事件历史。
6. `src/tui/active-subagent-projection.ts` 把子 Agent 的 `start/end` 生命周期、
   稍晚到达的后代描述和界面隐藏操作合成一份快照。状态栏数量、`/agents`
   列表与会话切换拦截只读这份快照，避免各处分别计算后出现短暂不一致。

## 代码边界

| 层次 | 主要位置 | 责任 |
| --- | --- | --- |
| 产品入口 | `src/bin.ts`, `src/bootstrap/`, `src/cli/` | 启动治理、信任、配置、委托 |
| 终端产品层 | `src/tui/` | TUI、事件投影、交互命令、MCP 管理 |
| 上游核心 | `deepseek-harness/packages/core/` | Agent、Agent Loop、Session、Tools |
| 模型层 | `deepseek-harness/packages/llm/` | 模型目录、适配器、流式响应、Token 统计 |
| 能力层 | `deepseek-harness/packages/{mcp,skill,shell,sandbox,plan,goal,jobs,subagent}/` | 可组合能力插件 |
| 持久化层 | `deepseek-harness/packages/session/` | Session JSONL、恢复、查询与投影 |

这条边界的核心约束是：`dsh-code` 是薄终端宿主，不维护第二套 Agent Loop、
Session Store、Permission Engine 或 Tool Registry。
