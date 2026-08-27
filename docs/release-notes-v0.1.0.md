# Seal Harness v0.1.0

首个可下载运行的开发者预览版。

## 使用方式

1. 下载与你系统匹配的压缩包；
2. 解压到任意目录；
3. Windows 运行 `seal-harness.cmd web`，Linux/macOS 运行 `./seal-harness web`；
4. 在 WebUI 的 Connection 面板选择工作区、模型并设置 API key。

发行包已经内置 Node.js 和生产依赖，不需要安装 Node、npm 或 pnpm。

## 包含能力

- Local-first WebUI；
- Headless Agent CLI；
- Pi Agent Runtime 与多 Provider 模型目录；
- Workspace 文件、搜索和 Shell 工具；
- Policy 与浏览器审批；
- JSONL Session、恢复、分叉和上下文压缩；
- 内容寻址附件；
- 插件微内核和原生 ESM Profile。

## 安全提示

WebUI 默认仅监听 `127.0.0.1`。当前版本没有用户认证，不要直接暴露到公网。
Session 和工具结果可能包含敏感内容，请妥善保护解压目录及工作区。

## 校验

下载 `SHA256SUMS.txt` 后可校验发行文件完整性。
