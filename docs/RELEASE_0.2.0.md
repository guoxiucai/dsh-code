# 0.2.0 正式版发布记录

日期：2026-10-08。包名：`@tsingwill/dsh-code`，目标 dist-tag：`latest`。
源码标签 `v0.2.0` 对应 `a478678fd2f93dfc3bd53584eb8e7860117b8d21`，
上游固定 `0.2.0-rc.2` / `639ed015397290b3745d163aafe02ffee4aa3f84`。

## 本版变化

- 同步上游 `0.1.7-rc.2` → `0.2.0-rc.2`，显示未开始和结果未知的工具请求，保持实时与回放一致。
- 新增 `/plugins` 内联管理：安装、启停、精确版本更新、卸载、组件诊断、安装取消、
  构建脚本审批及保留历史的同会话重载。内置插件列表按 Esc 返回已安装列表。
- 在全部 TUI 命令注册完成后初始化斜杠命令补全。
- 阻止 ACP/Web/headless/SDK 独立应用 bundle 与 TUI 共用 profile，并在会话选择前
  检查已有冲突，避免其他应用的参数解析器拒绝 `--resume`。
- 产品级 MCP client/core 安全覆盖固定到 2.2.0，同时作用于 pnpm workspace 与 npm shrinkwrap。

插件范围见[插件管理说明](PLUGIN_MANAGEMENT.md)，上游适配及旧 shell-first 日志限制见
[升级回归报告](UPSTREAM_0.2.0_REGRESSION.md)。本版未新增 timed 问答或 Schedule 的 TUI 页面。

## 发布验证

本地 macOS arm64 / Node 22.19.0：类型检查、40 文件 / 275 项测试、上游 host/client、
产品及 Web 构建、候选包检查、隔离安装、Standard/PTC profile 初始化、PTC 返回 42、
与独立 `dsh` 共存检查通过。

发布流水线：[Release 37707934550](https://github.com/guoxiucai/dsh-code/actions/runs/37707934550)。
CI 的 275 项测试、包审计、macOS arm64 / Windows x64 / Linux x64 × Node 22.19 / 24
六组安装 smoke 全部通过，release 环境审批后通过 OIDC 发布。
NPM `latest=0.2.0`，provenance 为 SLSA v1；
[GitHub Release](https://github.com/guoxiucai/dsh-code/releases/tag/v0.2.0) 为非草稿正式版。

候选包 `tsingwill-dsh-code-0.2.0.tgz`：294757 bytes，SHA-256：
`f692ff1f850429ed01ec415f550ae5d84ccc52667625f31dd21354d74a787789`。
远端 Ubuntu 与本地 macOS 生成的候选包字节一致；278 个 DSH 包固定到 `0.2.0-rc.2`，
CycloneDX SBOM 共 605 个组件。
Registry 下载的 tarball SHA-256 与候选一致，SHA-512 integrity 为：
`sha512-MmwX7ayeejRzeNHxANaLDvX6oifCwY0FD75IPdNPnOzwuyG78434COXkNCBG8b0zeNdvdvriaAdKWzwYs7SFUw==`。

发布后在 macOS arm64 隔离 prefix 从 registry 安装 `@tsingwill/dsh-code@0.2.0`，
`--version`、`--help`、已安装包的 Standard/PTC profile 初始化通过；实际 MCP client/core
解析均为 2.2.0。临时 prefix 已清理，未替换本机原有全局命令。

## 安全依赖与兼容边界

首次准备过程被 npm audit 的 5 条 high 记录拦截，未创建标签或发布。
这些记录来自同一 MCP client OAuth 依赖链，关联
[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)。
采用官方修复版本 MCP client/core 2.2.0，并在发布检查中验证所有锁定节点使用覆盖版本；
保持上游子模块不变，未放宽审计门禁。当前 dsh-code MCP 传输未使用 OAuth 凭据存储接口。

修复后本地审计为 9 moderate、0 high、0 critical：

- Office/LibreOffice 依赖链的 fflate ZIP64 解析问题：
  [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98)。
- smol-toml 1.8.0 解析复杂度问题：
  [GHSA-r4xh-jqrq-34v2](https://github.com/advisories/GHSA-r4xh-jqrq-34v2)。

通过发布门禁不代表零漏洞。安装 smoke 使用临时目录及显式测试权限，不等于验证各平台
内核沙箱隔离；本次不进行付费模型 API 测试。

## 安装

```bash
npm install -g @tsingwill/dsh-code@0.2.0
dsh-code --version
```
