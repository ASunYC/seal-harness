# Seal Harness v0.2.0

完整品牌重命名版本。项目、仓库、npm scope、CLI、WebUI、配置和发行资产统一使用
`seal-harness`。

## 下载与启动

Windows：

1. 下载并解压 `seal-harness-windows-x64.zip`；
2. 双击 `Start Seal Harness.cmd`；
3. 或在终端执行 `.\seal-harness.cmd web`。

Linux / macOS：

```sh
./seal-harness web
```

发行包内置 Node.js 与生产依赖，不需要安装 Node、npm 或 pnpm。

## Breaking changes

- npm scope：`@seal-harness/*`；
- CLI：`seal-harness`；
- 环境变量：`SEAL_HARNESS_PROVIDER`、`SEAL_HARNESS_MODEL`；
- 默认数据目录：`.seal-harness/`；
- Profile 文件示例：`seal-harness.config.mjs`；
- RPC：`seal-harness-rpc`；
- GitHub 发行资产：`seal-harness-<platform>-<arch>`。

旧版本 Release 保留为历史，但后续版本只使用新名称。

## 安全提示

WebUI 默认仅监听 `127.0.0.1`。当前版本没有用户认证，不要直接暴露到公网。
