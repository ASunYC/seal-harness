# Seal Harness 项目迁移与品牌替换

## Goal

将用户提供的 `seal-harness-master.zip` 中的下游桌面工程迁入空的 `seal-harness` 仓库，保留 DSH Desktop 的上游装配机制，形成统一的 Seal Harness 产品身份。

## Requirements

- 迁入可构建的工程源码、上游来源与许可证信息，不迁入旧开发会话与已完成任务状态。
- 保留 Cordis 插件、bundle/profile、Beta Desktop 产品配置及现有 Yarn 构建链；`deepseek-harness` 保持上游子模块边界。
- 将Seal Harness/seal-harness/GEOVIS 的产品身份改为 Seal Harness/seal-harness，包括包名、命令、应用 ID、协议、数据目录、窗口、安装器、更新边界和运行时文案。
- 按用户指定的 ip-as-logo 风格生成一只小海豹，并替换产品原始图标及 Windows/macOS/Linux/tray/UI 派生资源。
- 保留上游 DSH Desktop 和第三方来源说明，不将上游项目名称误改为本产品。

## Acceptance Criteria

- [x] 本地工程可在当前仓库找到，产品入口与所有资源都指向 Seal Harness 身份。
- [x] 不再有会影响构建或产品界面的旧产品名；必要的历史来源记录明确标为来源。
- [x] 图标生成结果已进入产品资产目录，衍生图标与 provenance 一致。
- [x] 执行可用的品牌、资源、构建与静态验证；未能执行的平台验证明确列出。
- [x] `git status` 中仅包含本次迁移所需文件，无构建产物、秘密或旧会话状态。
