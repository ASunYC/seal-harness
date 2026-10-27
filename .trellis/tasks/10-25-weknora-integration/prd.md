# 本地部署 WeKnora 并集成 DSH 插件

## Goal

使用本机 Docker Compose 部署固定版本的 WeKnora 知识库服务，把 WeKnora 官方 `@wxg-prc-cpg/dsh-weknora` 插件作为 Seal Harness Desktop 的本地产品插件装配，完成检索工具的端到端验证，并将已验证的 WeKnora 应用镜像推送到用户当前阿里云镜像仓库。

## Requirements

- WeKnora 数据与密钥留在本机容器卷和被 Git 忽略的环境文件中。
- 插件源自工作区 WeKnora 仓库 `packages/dsh-weknora`，保留来源、版本和 MIT 许可；不依赖该工作区的绝对路径运行。
- Seal 沿用 DSH 原生会话和工具注册，只增加 WeKnora 插件，不重建知识库服务。
- 阿里云仅上传应用镜像，不上传本地知识库数据、配置或密钥；依赖镜像按原厂来源部署。

## Acceptance Criteria

- [ ] Compose 核心服务健康，Web UI 与 API 本机可达。
- [ ] 至少一个可检索的测试文档在 WeKnora 入库，检索返回其内容。
- [ ] Seal 产品构建、检查与 Profile 启动通过，工具 `weknora_search` 在产品会话工具注册表可见，并能查询同一文档。
- [ ] 本地固定版本应用镜像与阿里云目标仓库的远端 digest 一致。
- [ ] 明确记录实测与尚未验证的模型、UI、跨平台范围。
