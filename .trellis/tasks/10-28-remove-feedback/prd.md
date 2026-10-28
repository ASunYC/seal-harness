# 移除 Seal 反馈入口及反馈遥测上传

## Goal

移除 Seal Harness 继承的反馈功能，关闭其向 DeepSeek OTel collector 上传会话日志的通道。

## Requirements

- 在产品 `cordis.patch.yml` 禁用 `ui-message-feedback`、`command-feedback` 和 `session-telemetry-otel`；关闭点赞/点踩、反馈弹窗与 `/feedback` 命令。
- 复用公开 Loader 配置，不改上游子模块、共享 Desktop 实现、用户历史反馈或数据库。
- 在产品 `verify.mjs` 的真实 Profile 组合检查中验证上述插件禁用，且不依靠验证进程的遥测禁用环境；继续验证正常会话/业务插件。
- 更新桌面构建契约，运行产品 build/check，重启用户已授权启动的桌面并核对反馈入口消失。

## Acceptance Criteria

- [x] 产品组合中反馈界面、命令与反馈遥测均禁用。
- [x] 产品 build/check 通过，原生会话、浏览器 MCP 和其他产品插件保持通过既有验证。
- [x] Windows 桌面重启健康，反馈界面不再装配。

## Boundary

不删除既有反馈记录，不更改模型提供方或单独的官方模型 API Session Log 设置；不提交、推送或发布。实现范围限产品 overlay、产品组合检查、对应规范与本任务资料。

## Validation

- Node 24 + 根 Corepack/Yarn 构建入口 `desktop.mjs build` 通过；日志 `.build/remove-feedback-build.log`。
- 产品 `verify.mjs` 独立通过：遥测禁用参数为空，三项禁用来自产品 overlay。
- 完整 `desktop.mjs check` 首次失败于既有 Stable Electron 元信息检查的 15 秒冷启动超时；复测通过，未修改或放宽测试。完整复测日志 `.build/remove-feedback-check-retry.log`。
- 真实 Electron Profile：standard 会话、24 个浏览器 MCP 工具、Creator、插件管理器及两轮 HMR 通过。
- Windows 桌面重启后 `rendererStatus: healthy`；只读检查实际页面 87 个客户端模块，反馈插件不在加载图中，提交反馈弹窗不存在。未发送真实反馈或触发模型调用。
- `git diff --check` 通过；未修改上游、未提交或推送。macOS/Linux 图形端未实测。
