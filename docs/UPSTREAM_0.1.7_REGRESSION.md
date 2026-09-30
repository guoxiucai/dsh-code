# dsh-code 0.1.7 上游同步与 TUI 回归

验证日期：2026-09-29。产品版本为 `0.1.7`；2026-09-30 按用户要求提交，未推送或发布。

## 固定版本与阶段影响

- 原上游：`dsh-v0.1.6-alpha.2`，`ddefc45fbc7f8e46dd73185e68295696d1297887`。
- 新上游：`dsh-v0.1.7-rc.2`，`477b4f420553e8a52c2fbccc464d7561b239c443`。
- 上游子模块只更新固定提交，无本地源码修改。

| 阶段 | 与 TUI 有关的变化及处理 |
| --- | --- |
| 0.1.6-alpha.2 → 0.1.7-alpha.1 | Session v4 改用原生 tool-role 结果、producer-owned 消息来源，并加强生命周期与 system head 校验。预设改为 registry 与声明式 patch；设置改为 profile patch 持久化；jobs 使用 Session ID；shell 改为 execute/result。均已适配。同步 pi-ai 流式参数解析的 workspace patch。 |
| alpha.1 → alpha.2 | workspace 依赖精确版本及 vendored 依赖调整、模型发现/显示、插件恢复行为变化。更新 lockfile，通过真实预设启动及模型设置跨进程保存验证。 |
| alpha.2 → rc.1 | Web 工具 preparing 是临时展示状态，不是新持久化事件；TUI 保持 Working 到正式工具卡片的流程。插件 peer 兼容检查、Office/表格预览依赖随上游更新。 |
| rc.1 → rc.2 | 动态工具更新开始发出 developer/message（事件格式已在 alpha.1 引入），TUI 接受其回放并交由上游投影模型上下文；审批支持 displayReason，自动审核转人工的请求沿用审批面板；子代理目录递归查询仍使用上游公开接口。定时问答的改动最终已撤回，不给 TUI 添加超时默认回答；也未额外启用 schedule/time-context。 |

## 下游行为

- Standard/PTC 从发布包导出的 preset YAML 组装；TUI 启动不运行 Web 服务。
  刷新生成的 profile 时保留模型设置、提供商和用户插件，包括 `!!js` 表达式。
  `/model` 使用上游模型选择服务保存，自定义提供商按单个路径更新，避免覆盖其他提供商。
- Session 列表支持 v4，并继续拒绝降级读取未来版本。工具结果读取原生 `toolCallId`、
  `content`、`isError`，通知按 `form` 判断。动态工具 developer 消息属于已知非展示事件。
- `/jobs` 的列表、详情、终止传入 Session ID；查看输出使用 `readAt`，不消费模型读取游标。
  用户 shell 使用新的 execute/result API，审批优先显示上游英文 presentation reason。
- `!command` 在 inbox insertion 时即持久化并显示卡片，在模型循环建立 system head 后
  才成为模型上下文；接纳事件按消息 ID 去重。取消或退出清空队列后，已执行结果仍可在
  下一次提问时恢复。shell-only 会话支持保留、标题、克隆、恢复和 Markdown 导出。
  `!!command` 仍只在当前终端显示，不进入模型上下文。
- 同步上游 workspace patches、原生包安装豁免和解压依赖。pnpm patch 适用于本地
  workspace；npm 候选包通过精确版本依赖和 shrinkwrap 安装，不宣称自动携带 pnpm patches。

## 历史日志兼容边界

合法顺序的 v3 日志由上游迁移为 v4；集成测试覆盖系统消息、shell 上下文、工具调用与
结果的真实迁移，验证原 v3 文件字节不变、TUI 回放和导出。

**0.1.6 中先执行 `!command`、后首次提问的旧日志可能把 shell user/message 写在
system/message 前，上游 v4 拒绝这种顺序。** 只有 shell、尚未写入 system 的旧日志
也不能直接继续提问，否则会产生无法重新读取的 v4 日志。TUI 对后一种情况提前拒绝
继续，不改写原始历史；用户应新建会话，旧日志需单独迁移修复。此次未实现这类历史日志
的自动修复，不将测试通过解释为所有旧会话都能无缝迁移。

## 验证结果

环境：macOS arm64，Node 22.19.0。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm run build:lib` | 原生 addon、host/client 构建通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 产品和 Web 构建通过 |
| `pnpm test` | 37 文件、251 用例通过，无跳过 |
| `node lib/bin.js --version` | `0.1.7` |
| 真实 PTY | 工具闭环、clone/resume、退出、shell 上下文与取消通过 |
| `smoke-install.mjs --coexist` | 隔离 npm 安装、CLI、Web 静态资源、PTC 结果 42、独立 dsh 共存通过 |
| `git diff --check` | 通过 |

PTY 使用隔离临时 home/project 和本地 mock adapter，验证模型→bash→工具结果→最终
回答；`!` 包含/`!!` 排除；首输出前 Esc、shell Esc；恢复后上下文；shell-only clone、
恢复及首次模型接纳。未读取真实用户凭据或调用付费模型。

未在本轮重跑 Windows/Linux 实机及浏览器 GUI 往返，不将本机结果外推为这些环境的
完整验收。旧上游已删除 workspace 的生成目录移到系统临时目录备份后再安装构建，
没有修改上游源文件或跳过类型检查。

## 候选包与依赖审计

- `dist/npm/tsingwill-dsh-code-0.1.7.tgz`：283683 bytes。
- SHA-256：`418e31562c9f53195dca8d6bdbd96a1afe5e2d520152af17a2f9fd6dce206c3e`。
- `build-release.mjs --skip-build`、`verify-tarball.mjs` 通过；273 个 DSH 包固定到
  `0.1.7-rc.2`，CycloneDX SBOM 共 591 components。
- npm audit：8 moderate、0 high、0 critical。8 条记录来自同一项
  `fflate >=0.8.0 <0.8.3` 的畸形 ZIP64 解析无限循环问题
  （`GHSA-px8p-9vwx-vf98`），经 LibreOffice Kit、Office skill/preview、SDK/Web
  传播到 DSH。沿用上游版本，未擅自替换这条发布依赖链；门禁通过不等于零漏洞。
