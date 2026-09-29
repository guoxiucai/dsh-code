# 0.1.6 正式版发布记录

日期：2026-09-29。包名：`@tsingwill/dsh-code`，目标 dist-tag：`latest`。
上游固定 `dsh-v0.1.6-alpha.2` / `ddefc45fbc7f8e46dd73185e68295696d1297887`。

## 功能与平台

- 支持 macOS 14+ arm64、Windows 10+ x64、Linux x64；Ubuntu 22.04 真机验证记录及用户
  验收确认见 [Linux 验证记录](LINUX_VALIDATION.md)。其他 Linux 发行版、ARM64/musl 未验证。
- `!` shell 结果持久化并进入上下文，`!!` 仅终端展示；恢复 shell-only 会话。
- 修复首个输出前 Esc 无法及时取消的问题。
- 接受 `image/offload` 事件，保持可见历史；模型上下文投影继续由上游负责。

## 验证与发布门禁

本地 macOS arm64 / Node 22.19.0：上游 host/client 构建、产品与 Web 构建、类型检查、
36 个测试文件 / 244 项测试、候选包审计、全新 npm 安装、PTC 返回 42、独立 `dsh`
共存验证通过。Linux 桌面真机验证来自用户确认，不冒充本轮 Agent 的 GUI 复测。

CI / Release 新增 Ubuntu 24.04 x64、Node 22.19 / 24，从同一 tarball 验证六组平台/Node
组合；Node 22.19 各平台额外运行独立 `dsh` 共存检查。安装 smoke 使用临时目录和显式
测试权限，不代表验证了各平台内核沙箱隔离。

首次 [发布门禁运行](https://github.com/guoxiucai/dsh-code/actions/runs/36507006280)
在 Linux PTC 预设组装测试中失败（未得到预期结果 42），未进入 npm 发布。
该测试此前继承默认 sandbox policy，与只验证进程执行的安装 smoke 范围不一致；
修正为临时目录内显式测试权限，补充运行失败的完整诊断，不修改产品默认权限。
CI 在测试前生成产品 JS，避免 warning-filter 测试因缺少构建产物而跳过。
未发布候选标签已更新为 `1d2a74ad4c1fa5265392c6249bc51d5b9688847a`。

最终运行：[Release 36507626951](https://github.com/guoxiucai/dsh-code/actions/runs/36507626951)，
Ubuntu 源码测试 36 文件 / 244 项全部通过，无跳过；六组 clean-install smoke 全部通过。
发布 job 成功，npm `latest=0.1.6`，provenance 使用 SLSA v1；
[GitHub Release](https://github.com/guoxiucai/dsh-code/releases/tag/v0.1.6) 为正式版。
Registry 的 SHA-512 integrity 与远端候选一致：
`sha512-aeaJS7jsLW5+As1Wa71MorbJE3IGFzPZbVYrWlTz38NDJNc8ksJGogsObrJ5gtgCIpWrnqACM7zg1CDXc5zw9A==`。
发布后在 macOS arm64 隔离 prefix 直接执行 `npm install -g @tsingwill/dsh-code@0.1.6`
成功，`--version` 输出 `0.1.6`，`--help` 正常退出；从 registry 下载 tarball 的 SHA-256
也与候选一致。未替换本机原有全局安装。

候选包 `tsingwill-dsh-code-0.1.6.tgz`：275858 bytes，SHA-256：
`c48c4b1abcbe507d0db0331674eafbec7411aa24c00bfa81727acb7e664c6e4e`。
远端 Ubuntu 构建与本地 macOS 构建字节一致；锁定 250 个上游 DSH 包到
`0.1.6-alpha.2`，CycloneDX SBOM 共 554 个组件。

## 已知依赖限制

本地候选 npm audit：5 moderate、0 high、0 critical。5 条记录属于同一依赖链
`dsh → dsh-web-app → dsh-office-to-pdf → libreoffice-kit → fflate`，
对应 `GHSA-px8p-9vwx-vf98`（畸形 ZIP64 解析无限循环）。
本次未覆盖上游 Office 依赖版本；通过现有 high/critical 阻断门禁不等于零漏洞。

## 安装

```bash
npm install -g @tsingwill/dsh-code@0.1.6
dsh-code --version
```
