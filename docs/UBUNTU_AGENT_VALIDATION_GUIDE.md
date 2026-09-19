# Ubuntu 实机验证手册（交给 Code Agent）

基线：`@tsingwill/dsh-code@0.1.5`；编写日期：2026-09-19。
背景和已有 CI 证据见 [Linux 验证记录](LINUX_VALIDATION.md)。

## 1. 任务目标与执行约束

目标是在真实 Ubuntu 上**从 npm 安装产品并验证实际执行**，不是只运行仓库单元测试，也不是用独立安装的上游 `dsh` 代替产品。

当前 0.1.5 在产品入口只放行 macOS arm64 / Windows x64。因此本手册有两个独立阶段：

- **A：未修改的 npm 原包验收。** 必须先执行，即使安装成功，实际启动预计仍报告 unsupported platform。该结果必须保留。
- **B：实验性 Linux 运行探测。** 仅在用户明确授权后，对隔离 npm 安装副本的最小平台门禁做修改，再验证 TUI、会话、PTC、Web 等。不能把 B 的成功写成 A 成功，也不能因此宣告 npm 正式支持 Linux。

若用户选择验证未来已经放行 Linux 的 npm 版本，先固定其确切版本并核查实际行为；不要默认它与 0.1.5 相同。

约束：

1. 不使用 `sudo npm install`，不覆盖已有全局包，不修改系统 Node、真实项目或现有 `~/.dsh*` 配置。不覆盖 `HOME`。
2. 使用本手册创建的临时 npm prefix、产品配置目录、项目目录；所有写文件/工具测试仅针对测试夹具。
3. 不更改 `process.platform`，不冒充 Darwin；这会使下游选择错误原生模块与 shell，结果无效。
4. 不默认开启 `danger-full-access`，不因沙箱失败而自动关闭安全限制，不改 AppArmor/sysctl 或内核策略。
5. 不记录 API key、完整环境变量、含认证参数的 Web URL。配置凭据时暂停录屏/终端录制；输出证据前脱敏。
6. 不提交、推送或发布包，不自动升级产品。安装系统依赖、调整安全配置和扩大源码修改范围须另行确认。
7. 每项结果只能是 PASS / FAIL / BLOCKED / NOT_RUN，并注明版本、是否修改门禁及证据。Agent 不能操作真实终端/浏览器时，交给用户执行并收集结果，不能虚报。

## 2. 环境矩阵与准备

优先：Ubuntu 24.04 x86_64 + 桌面终端 + 默认浏览器；分别使用 Node 22.19.x、Node 24.x 验证，每组使用独立临时目录。记录准确 patch 版本。不要因一组成功推断另一组成功。

ARM64、其他 Ubuntu 版本、WSL2、Docker、SSH 均可以补测，但必须单列；容器/WSL 不能替代原生 Ubuntu 内核和桌面验收。无 GUI 的机器仍可验证 CLI/TUI 与 HTTP 服务，但“默认浏览器自动打开”记为 BLOCKED，不得记为 PASS。

前置工具：Node/npm、bash、git；终端录制可使用 util-linux 的 `script`，截图由桌面或浏览器自动化工具提供。缺少工具先报告，用户授权后安装，不要一开始安装完整编译链掩盖普通 npm 安装的问题。

以下命令在 **同一个 Bash 会话** 中执行。已有 Node 不符合目标版本时，先请用户提供或授权配置对应版本。不要直接执行来源不明的网络安装脚本。

```bash
bash
umask 077
export DSH_LINUX_VERSION=0.1.5
export DSH_LINUX_ROOT="$(mktemp -d /tmp/dsh-code-linux-XXXXXX)"
export DSH_LINUX_PREFIX="$DSH_LINUX_ROOT/npm-prefix"
export DSH_LINUX_PROJECT="$DSH_LINUX_ROOT/project"
export DSH_LINUX_EVIDENCE="$DSH_LINUX_ROOT/evidence"
export DSH_CODE_HOME="$DSH_LINUX_ROOT/product-home"
export DSH_TELEMETRY_DISABLED=1
mkdir -p "$DSH_LINUX_PREFIX" "$DSH_LINUX_PROJECT" "$DSH_LINUX_EVIDENCE" "$DSH_CODE_HOME"
printf '%s\n' "$DSH_LINUX_ROOT"
{
  date -Is
  uname -a
  cat /etc/os-release
  getconf GNU_LIBC_VERSION
  node --version
  npm --version
  node -p 'JSON.stringify({platform:process.platform,arch:process.arch})'
  printf 'TERM=%s\nDISPLAY=%s\nWAYLAND_DISPLAY=%s\n' "${TERM-}" "${DISPLAY-}" "${WAYLAND_DISPLAY-}"
  command -v node npm bash git script xdg-open bwrap || true
} > "$DSH_LINUX_EVIDENCE/environment.txt" 2>&1
cd "$DSH_LINUX_PROJECT"
git init
```

记录终端程序及版本、桌面类型（Wayland/X11）、是否 SSH/虚拟机，以及是否存在用户自定义 npm registry。不要运行 `env`、`npm config list` 或复制 `.npmrc` 来收集证据，其中可能包含凭据。

## 3. A 阶段：npm 原包安装及入口验证（必须）

### A01：固定包版本和来源

```bash
npm view "@tsingwill/dsh-code@$DSH_LINUX_VERSION" \
  version engines dist.tarball dist.integrity --json \
  > "$DSH_LINUX_EVIDENCE/npm-metadata.json"
npm install --global --prefix "$DSH_LINUX_PREFIX" \
  "@tsingwill/dsh-code@$DSH_LINUX_VERSION" --no-audit --no-fund \
  > "$DSH_LINUX_EVIDENCE/install.log" 2>&1
DSH_LINUX_INSTALL_RC=$?
printf '%s\n' "$DSH_LINUX_INSTALL_RC" > "$DSH_LINUX_EVIDENCE/install.exit"
export DSH_LINUX_BIN="$DSH_LINUX_PREFIX/bin/dsh-code"
export DSH_LINUX_PACKAGE="$DSH_LINUX_PREFIX/lib/node_modules/@tsingwill/dsh-code"
```

若退出码非 0：记录是网络/registry、engine、原生模块、安装脚本还是权限失败；后续运行测试记 BLOCKED。先保留原始失败，不通过 `--ignore-scripts`、`--force` 或安装编译工具使原始失败消失。经确认后的重试另存日志。

成功后：

```bash
readlink -f "$DSH_LINUX_BIN"
npm list --global --prefix "$DSH_LINUX_PREFIX" --depth=0 \
  > "$DSH_LINUX_EVIDENCE/installed.txt" 2>&1
"$DSH_LINUX_BIN" --version > "$DSH_LINUX_EVIDENCE/version.txt" 2>&1
"$DSH_LINUX_BIN" --help > "$DSH_LINUX_EVIDENCE/help.txt" 2>&1
sha256sum "$DSH_LINUX_PACKAGE/lib/cli/platform.js" \
  > "$DSH_LINUX_EVIDENCE/original-platform.sha256"
```

断言：可执行文件解析到隔离 prefix；版本与固定版本一致；help 正常；没有用 PATH 中另一份 `dsh-code` 冒充本次安装。安装成功与产品可运行分开计分。

### A02：实际产品入口

在真实 PTY 中执行下面各命令，逐个记录 stderr、退出码。不要给交互 TUI 接普通管道，否则会引入非 TTY 问题。

```bash
"$DSH_LINUX_BIN"
printf 'exit=%s\n' "$?"
"$DSH_LINUX_BIN" -r
printf 'exit=%s\n' "$?"
"$DSH_LINUX_BIN" -p '只回复 LINUX_BASELINE_OK'
printf 'exit=%s\n' "$?"
```

0.1.5 预期：三项退出码为 1，提示 `unsupported platform linux-x64`（ARM 则为 `linux-arm64`），未进入 TUI / 模型交互。这是**门禁行为符合预期**，同时意味着**原包 Linux 可用性未通过**。`--help` / `--version` 成功不能抵消它。

若原包能够进入：记录意外结果，核对包版本、真实 bin 路径和 `lib/cli/platform.js`，查明后再继续。不要未经确认直接沿用“0.1.5 已放行”的结论。

### A03：保留基线与决策

给用户阶段报告：安装是否成功、入口是否拦截、当前能否按原样使用。若拦截，申请：

> 是否允许仅修改本次临时 npm prefix 内的平台白名单，放行本机 Linux 架构，继续实验性功能验证？不修改全局安装、上游依赖或权限策略；结果单列为 patched-install。

未获授权：B 阶段记 BLOCKED，交付 A 阶段报告与后续清单；不要自行绕过保护。

## 4. B 阶段：隔离安装副本的最小放行（需授权）

仅适用于门禁拦截的版本。先备份并记录补丁：

```bash
cp "$DSH_LINUX_PACKAGE/lib/cli/platform.js" "$DSH_LINUX_EVIDENCE/platform.original.js"
```

Agent 读取实际文件，用自身文件编辑工具在 `SUPPORTED_PLATFORMS` 集合中**只增加本机组合**（例如 `linux-x64`）。禁止删除整个检查、修改 arch/platform 或改上游代码。文件结构与预期不同则停止，报告差异。已获授权仅限这一文件，不包含进一步修复。

```bash
diff -u "$DSH_LINUX_EVIDENCE/platform.original.js" \
  "$DSH_LINUX_PACKAGE/lib/cli/platform.js" \
  > "$DSH_LINUX_EVIDENCE/platform.patch"
# diff 返回 1 表示存在预期差异，不是执行失败。
sha256sum "$DSH_LINUX_PACKAGE/lib/cli/platform.js" \
  > "$DSH_LINUX_EVIDENCE/patched-platform.sha256"
```

从这里开始，每份结果标注 `patched-install`。仍通过绝对路径 `$DSH_LINUX_BIN` 启动；这是 npm 安装产物探测，不是源码构建产物。出现缺少原生依赖等问题先留证据，不临时替换依赖版本。用户批准修复后也必须作为新一轮测试，保留上一轮失败。

## 5. 凭据、信任与记录方式

1. 先在隔离配置目录中启动产品，验证首次配置流程或缺凭据提示不会崩溃/泄漏 key；此时无真实凭据，模型调用失败是预期，不算功能通过。
2. 获用户授权后，使用 `dsh-code config` 对应的绝对 bin 命令配置测试提供商。用户直接输入凭据；关闭输入记录/录屏。费用和联网请求须在用户允许范围内。
3. 信任提示只授权 `$DSH_LINUX_PROJECT`。恢复会话时确认仍指向该目录，不要选择用户真实项目。
4. 配置完成后再记录交互。推荐 `script -q -e -c "\"$DSH_LINUX_BIN\"" "$DSH_LINUX_EVIDENCE/tui.typescript"`；它保留终端控制序列，但不能取代截图。不要使用 `--log-in`。
5. 每项至少记录：步骤、会话 ID、预期、实际、退出码（适用时）、脱敏日志/截图位置。进入 TUI、渲染稳定时、退出后各截一张关键图。
6. 无凭据时可以做无模型用例，但模型、工具、Web 发消息等用例记 BLOCKED。仓库 mock 集成测试只能作为补充，不能冒充产品真实模型端到端成功。

## 6. 实际执行用例

以下均在阶段 A 未被拦截或阶段 B 已授权放行后执行。先做 Standard，再做 PTC；每次新建案例时记录新会话 ID。任何 crash、不可恢复卡死、数据丢失均记录独立缺陷。

### T01：启动、首次交互与流式输出

- 启动 `$DSH_LINUX_BIN`；验证无原生模块加载错误、无乱码、光标与输入框正常，默认 Standard。
- 输入 `只回复 LINUX_TUI_OK，然后输出两条中文项目符号。`；验证流式输出、最终内容、输入框重新可用。
- 连续发两轮，确认没有重复答复、工具正文或状态行遮挡后续内容。
- 输入一段含中文、emoji、多行的文本；验证编辑、退格、粘贴不破坏布局。
- 在模型执行中按 Esc：当前轮次可取消，后续可继续提问。不要把 Ctrl+C 当作本产品通用中断键，它用于复制选中文本。

### T02：用户 shell 输出与滚动（重点回归）

依次在 TUI 输入：

```text
!printf 'LINUX_SHELL_OK\n'
!seq 1 120
!sh -c 'printf "LINUX_STDERR\n" >&2; exit 7'
```

- 三次执行均完成，stdout/stderr 可见；失败退出不导致 TUI 崩溃。
- 再发送普通提问。旧 shell 输出留在对应历史位置，不永久固定占据输入框上方；无需每轮手动上滚才能看到新回答。
- 长输出可展开/折叠，Ctrl+O 与滚动可用；改变窗口宽高后不重复或错位。
- 用户 `!` shell 与 Agent 的工具权限路径可能不同，**不要用本项证明 Agent 沙箱隔离**。

### T03：真实 Agent 工具闭环与权限

提示：`仅在当前测试项目中新建 linux-smoke.txt，内容为 LINUX_TOOL_OK；用工具读取它，再用 shell 输出该文件内容。不要访问其他目录。`

断言：有真实工具调用/结果；文件实际存在且内容正确；最终回答与实际内容一致。用另一个 shell 读取文件交叉确认，不能仅相信模型文字。

再通过 `/permission` 检查可选预设，并分别验证：

- read-only：读取已有测试文件成功；请求写入被策略拒绝或触发明确审批，未授权前文件不能变化。
- workspace-write：项目内写入成功；项目外访问按实际策略被拒绝或请求审批。
- 故意拒绝一次审批，确认没有执行被拒绝的操作；允许一次后不自动形成永久授权。

项目外测试只使用 Agent 预先在 `$DSH_LINUX_ROOT/outside` 新建的无敏感数据夹具，不访问系统/用户文件。不要把项目外“读”和“写”的预期混为一谈，以当前上游预设定义为准；记录具体路径及策略。沙箱不可用时允许本项 FAIL/BLOCKED，但必须有清晰诊断，且不能静默降级 full-access。

### T04：退出后的历史保留（重点回归）

- 请求生成标题、列表、带语法高亮的短代码块、Markdown 表格；保留 T02 的 shell 输出。
- `/quit` 退出，截图终端 scrollback：已输出内容仍保留格式/ANSI 渲染；没有残留输入框、模式状态条、快捷键提示或重叠边框。
- 末尾有 `To resume this session: dsh-code resume <实际ID>`；复制 ID，用 `$DSH_LINUX_BIN resume <实际ID>` 验证历史恢复。
- 在另一有消息的会话中分别测试 `exit` 和空闲时 Ctrl+D，检查上述退出行为与终端回显、光标恢复。
- 在窄窗口、宽窗口各做一次。退出后输入普通 shell 命令，确认终端未遗留 raw mode 或隐藏光标。

### T05：新会话及空会话清理

- 以 `$DSH_LINUX_BIN --mode ptc` 启动，完成一轮后输入 `/new`。
- 验证新会话为空且模式为 Standard，不继承 PTC；前一会话仍可恢复。
- 不输入任何用户内容，立即 `/quit`；再用 `$DSH_LINUX_BIN -r`，新建空会话不应以 `no messages` 残留。
- 再建一个新会话，发消息后退出；这次必须持久化并可恢复。

### T06：resume、fork、clone 及多层级

1. 在父会话 A 连续发送唯一标记 `LINUX_A1`、`LINUX_A2`、`LINUX_A3`，等每轮完成。
2. `/fork`，在选择器选第二条用户请求：新子会话 B 自动激活；继承分支点之前的历史，不包含第二条请求及其后续旧回答；记录实际输入框是否预填选中请求。
3. 在 B 发送 `LINUX_B1`；再次 `/fork` 创建 C，再向 C 发送唯一标记。
4. `/resume` 打开交互选择页；A/B/C 显示正确父子层级，选择 A 后切换回 A，不只是关闭选择器。
5. A 中 `/clone` 创建 D 并自动切换；完整已有对话被复制；向 D 发消息不改变 A。
6. 完全退出再用 `-r`；树层级和各会话历史仍一致；`resume <ID>` 精确恢复，`-c` 恢复最近会话。
7. 取消 `/resume` 或 `/fork` 选择器，应返回原会话，不产生意外分支；`/tree` 不应作为受支持命令出现。

### T07：PTC 运行时

- 新会话使用 `--mode ptc` 或首轮前 `/mode ptc`；请求通过代码工具计算 `6 * 7` 并返回结果。
- 必须看到实际代码运行结果 42，不能只接受模型心算；记录 worker/TypeScript/native 模块错误。
- 执行一个受控代码错误后再计算，确认错误可恢复；对话首轮开始后 `/mode standard` 不应偷偷改变已有会话模式。
- 退出并恢复 PTC 会话仍为 PTC；`/new` 则恢复 Standard。

### T08：Web → TUI 往返（有 GUI）

1. 在有历史的会话输入 `/web`；默认浏览器打开页面。TUI 显示已切换、地址与返回提示，不再接受对话输入。
2. 记录子进程的可执行路径/命令（脱敏），确认使用隔离 npm 包解析到的上游 DSH，而不是 PATH 中独立 `dsh`。不要仅凭页面 logo 判断。
3. Web 中确认原会话历史与模型配置可用，无需配置另一份 token；不要显示 token 值作证据。发送 `LINUX_WEB_RETURN` 并等待完成。
4. 只关闭浏览器标签：Web 服务仍在，TUI 不应自动恢复。本产品监听服务进程，不监听标签关闭。
5. 回终端按 Esc：服务安全停止，TUI 重新加载原会话，包含 Web 新消息；再发一轮验证继续可写。
6. 再次 `/web` 后在终端 Ctrl+D：产品和 Web 子进程退出，记录端口无残留监听，不得杀其他用户进程。
7. 重复两次，确认无端口泄漏、会话锁冲突或重复消息。

服务地址只在本机使用；检查监听地址与实际认证保护。不要为验收把服务绑定到公网或开放防火墙。无 GUI/SSH 场景记录地址是否可用、是否报错可恢复；如需端口转发，须用户确认，并单列为远程浏览器验证，不算默认浏览器测试通过。

### T09：Linux 剪贴板与桌面差异

- 选择一段回答，按产品复制快捷键，再在独立编辑器粘贴；区分桌面终端自带复制与产品复制。
- 0.1.5 产品无 Linux 剪贴板后端，预期可能不可用。记为已知功能缺口，不伪造 PASS。
- 分别记录 Wayland/X11；若只有一种环境，另一种 NOT_RUN。不为测试擅自安装或接入剪贴板守护服务。

### T10：Headless、错误恢复与独立配置

- 已配置后运行 `$DSH_LINUX_BIN -p '只回复 LINUX_HEADLESS_OK'`，确认正常退出、stdout 结果与 stderr 行为。
- 使用一个新的空 `DSH_CODE_HOME` 单次调用相同命令（不要覆盖现有变量或删除已配置目录）：无凭据有可理解错误，非零退出，无 key 泄漏。
- 用户授权时临时模拟不可达 API endpoint，验证错误可恢复；恢复配置再跑成功用例。不要修改系统网络。
- 核对测试数据只进入指定产品 home，未读取/迁移真实 `~/.dsh`。不要主动运行 `import dsh`。
- 若机器已有独立上游 `dsh`，记录测试前后其路径/版本，确认未改变；若没有则标 NOT_RUN，不必额外全局安装。

## 7. 可选：源码回归辅助定位

只有 npm 路线结果已经留存后，才在独立仓库目录做源码回归。固定提交与上游 submodule，先读仓库指令；不要用源码启动成功替换 npm 路线失败。

```bash
git rev-parse HEAD
git submodule status
pnpm install --frozen-lockfile
pnpm build:lib
pnpm build
pnpm typecheck
pnpm test
```

使用仓库 `packageManager` 指定的 pnpm 版本。这里先构建产品再测，避免 `node-warning-filter.spec.ts` 因产物不存在跳过。记录全部跳过项。现有 mock-loop 使用显式 full-access 测试配置，不能证明 Linux 沙箱成功。

## 8. 交付物与判定规则

在证据目录输出 `REPORT.md`（Agent 用文件编辑工具创建），结构至少为：

```markdown
# Ubuntu dsh-code 实机报告
## 环境
OS / kernel / glibc / arch / Node / npm / terminal / GUI / 原生或虚拟化
## 包与修改
package version / registry / dist integrity / bin realpath
baseline 或 patched-install / 补丁与前后 SHA256 / 用户授权范围
## 结果表
| ID | 环境及阶段 | PASS/FAIL/BLOCKED/NOT_RUN | 实际结果 | 证据路径 |
## 缺陷
复现步骤 / 预期与实际 / 影响范围 / 脱敏 stack / 是否稳定复现
## 结论
原包能否直接 npm 安装？能否原样启动？
放行副本能否完成 Standard / PTC / 会话 / Web / 沙箱闭环？
未覆盖项、已知缺口、建议修复与发布前门禁
```

- A 阶段被门禁拦截：原包 Linux 运行结论为“不支持”，即使 B 全通过也不能改成支持。
- 原生依赖无法加载、会话损坏、权限越界、静默 full-access 降级、Web 凭据泄漏：发布阻断问题。
- 测试没执行、没有 GUI、没有 key、无沙箱后端：如实 BLOCKED/NOT_RUN，不补成通过。
- 一台 Ubuntu、一个 Node 版本成功不能外推全部 Linux。修复后需从全新 prefix 安装新的候选 npm tarball 重跑，不以手改 node_modules 作为发布验收终点。

结束前先将脱敏证据交付用户。不要默认删除配置/会话或递归清理目录；需要清理时只针对已经记录的本轮绝对路径，确认用户不再需要证据。保持实验安装不进入永久 PATH，不留下后台 Web/测试进程。

## 9. 可直接交给下一位 Agent 的任务提示

> 请按 `docs/UBUNTU_AGENT_VALIDATION_GUIDE.md` 在本机 Ubuntu 执行 npm 实机验证。先固定 `@tsingwill/dsh-code@0.1.5`，使用隔离 prefix 和 DSH_CODE_HOME，完成 A 阶段并保留日志。原包若被 Linux 平台门禁拦截，先报告并询问是否授权 B 阶段最小放行，不自行修改安全策略。获得授权后逐项验证实际 TUI、shell 输出、退出历史、会话分支、PTC、Web 往返与真实沙箱；缺少凭据/GUI/工具时明确 BLOCKED。最终提供环境、包完整性、补丁、用例结果、截图/日志和缺陷清单，严格区分原包与 patched-install。不要提交代码或发布版本。
