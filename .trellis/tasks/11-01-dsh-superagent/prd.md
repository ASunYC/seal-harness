# 接入 DSH Superagent 独立服务与 Seal 入口

## Goal

将官方 Superagent 原型作为隔离服务接入 Seal，保留用户会话，并验证面板与部署流程。

## Requirements

- 使用官方 `deepseek-ai/dsh-superagent-prototype` 固定提交，独立于 Seal 主会话进程运行；不改动现有 DSH 内核版本和用户 Profile。
- 在 Windows 开发机通过 Linux 容器提供本机可访问的控制面板，数据持久化，不向局域网开放端口。
- Seal 内提供 Superagent 入口与服务状态，指向独立面板；断线时显示可执行的诊断信息。
- 默认目标仓库为 `ASunYC/seal-harness`，仅 GitHub 来源；不自动授权任何请求或创建机器人账号。
- 保留原型许可证和来源；专用 GitHub 账号、模型凭据由用户自行登录配置。

## Acceptance Criteria

- [x] 固定源代码提交的容器镜像能够构建，服务能启动并在本机响应面板与管理 API。
- [x] Seal 入口与离线/待配置状态有回归验证，现有主会话不受影响。
- [ ] 完成目标仓库、专用账号、允许列表、模型与执行目录配置后，能用测试 Issue 触发 Ticket。

## Notes

- 2026-11-01：服务已在 `127.0.0.1:3082` 响应，管理 API 返回 `repositoryUnset`；正在等待专用 GitHub 账号创建和授权。首次浏览器登录链接由服务日志提供，不写入聊天或代码。
