# 执行与验证

1. 检查工作区与 Docker 状态，记录官方版本和插件来源。
2. 生成本机忽略的部署环境文件，拉取固定镜像并启动 Compose；健康检查。
3. 将官方 DSH 插件并入 Seal 产品插件构建与 Profile；添加受影响区域的回归测试。
4. 创建一次性测试知识库和文档，验证 WeKnora 检索、插件工具调用、产品构建与 Profile 启动。
5. 核对阿里云目标仓库地址，推送已验证的 WeKnora 应用镜像并验证 digest。
6. 检查 diff、状态和未运行项；更新实际证据。

## 实际结果（2026-10-25）

- 从 Docker Hub 拉取 WeKnora `v0.8.3` 的 app、UI、docreader 镜像，连同 ParadeDB、Redis 启动五个容器。app、docreader、Postgres 健康；Web UI 返回 200，API `/health` 返回 `ok`。本机端口绑定为 `127.0.0.1:80` 和 `127.0.0.1:8080`，完成账号创建后关闭公开注册。
- 使用本机 Ollama 的 `nomic-embed-text` 和 `deepseek-r1:14b` 建立演示知识库。演示文档解析及摘要均为 `completed`。工作空间 API Key 只授予该知识库的 `retrieve`、`chat` 能力。
- 从 npm 获取 `@wxg-prc-cpg/dsh-weknora@0.1.0`，六个发布版 JS 文件按原样放入产品本地插件；产品构建装配为 `@seal-harness/weknora`。记录 npm 完整性和逐文件 SHA256，随包分发 MIT 许可证与来源。
- 产品构建 `npx --yes --package=corepack@0.34.5 -- node seal-harness-desktop/scripts/desktop.mjs build` 通过；`check` 通过，包括新增插件 HTTP 回归测试、产品装配测试、Electron Profile 启动。注入真实本机 API Key 后另跑 `verify-profile.mjs` 通过。已安装的产品插件对真实 WeKnora 执行列表、检索、全文读取与 RAG 问答；检索和问答都返回演示文档中的“星图”。
- 已推送应用镜像 `crpi-uu3f34olu93ufmcx.cn-beijing.personal.cr.aliyuncs.com/agentearth/weknora:v0.8.3`。本地 push、远端 manifest 和阿里云镜像版本页一致，digest 为 `sha256:cb4fe8b89c81d6e43754f7e5c685d155413c2da65ab2f98b8a62514f46c4e6b6`。
- 未提交、未推送 Seal Harness Git 代码。演示账号和 API Key 位于 WeKnora 工作区的忽略文件 `.weknora-local-credentials.json`；Compose 环境保存在忽略文件 `.env`。
