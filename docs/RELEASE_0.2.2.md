# 0.2.2 正式版发布记录

发布日期为 2026-11-20，npm 包为 `@tsingwill/dsh-code@0.2.2`，发布标签为 `latest`。
源码标签 `v0.2.2` 指向 `03bf5e13cf401db432d2f210e78c48afa5b72e07`，
上游固定到 DeepSeek Harness `0.2.2-rc.5`（`9c2670d3bce5275e0d1610272958121af87787bb`）。
最低运行版本为 Node.js 24.9。

本版适配会话模型和预设恢复、插件版本更新、PTC 结果回放及 MCP 配置。工作区和 npm 包均将
受影响的 Undici 8 依赖固定到 8.12.3。正式发布候选的 npm 审计有 14 条记录，高危和严重均为 0。

[首次运行](https://github.com/guoxiucai/dsh-code/actions/runs/44745690203) 在 Linux 生成锁文件时
将 macOS 专用依赖提升为必装包，触发 `EBADPLATFORM`。发布脚本将平台限定依赖写入精确锁定的
`optionalDependencies`。[第二次运行](https://github.com/guoxiucai/dsh-code/actions/runs/44746702994)
完成打包及 Linux 安装，但 GitHub 拒绝启动 `macos-14` runner。CI 和发布流程改用
`macos-15` arm64 runner，两次均在 npm 上传前停止。

[最终运行](https://github.com/guoxiucai/dsh-code/actions/runs/44747753209) 的候选包包含 328 个固定到
上游基线的 DSH 依赖，CycloneDX SBOM 包含 672 个组件。远端候选与本地 Linux 目标打包结果字节一致。

候选包 `tsingwill-dsh-code-0.2.2.tgz` 为 305024 字节，SHA-256 为
`fd58d756f900acd862ce3f2ff066e0346780d44084ca67ba6cf0a7563384bc28`。

CI 的 275 项测试和 macOS arm64、Windows x64、Linux x64 各自的 Node 24.9 与最新 24.x
安装均通过。最后一组 macOS 因 runner 容量不足被取消，重跑复用了原候选包并通过。
OIDC 上传成功后，npm 的版本索引超过了流水线的 120 秒核验时限。重跑发布任务时版本已可见，
流水线核对了原包完整性并完成 [GitHub Release](https://github.com/guoxiucai/dsh-code/releases/tag/v0.2.2)。

npm 的 `latest` 已指向 `0.2.2`，SLSA v1 provenance 已核对。registry 下载包的 SHA-256
与候选一致，SHA-512 integrity 为
`sha512-84uOVcFvRYU3nTyWTutpwWZ/zUkNFNT2WTgbz27u7JnyEFJ4+tGcghQRj2IqkQ+YMOc0Shh9rqVTkV+ioASyiQ==`。
在 macOS arm64 的隔离前缀中，从 registry 直接安装后验证了版本、帮助、上游基线及 Standard/PTC
profile 初始化。

```bash
npm install -g @tsingwill/dsh-code@0.2.2
dsh-code --version
```
