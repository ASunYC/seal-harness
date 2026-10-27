# 容器化 Ollama 并接入 WeKnora 模型设置

## Goal

打包所需 Ollama 模型、部署与推送阿里云，并在 Seal 设置提供 WeKnora 原生模型配置入口

## Requirements

- 只将本地向量模型 `nomic-embed-text` 连同 Ollama 装入私有镜像；问答 LLM 由 WeKnora 接入外部服务。镜像不包含其他模型、用户知识库数据或密钥。
- Compose 一条命令启动 WeKnora 全栈与容器化 Ollama；停止 Windows 宿主机 Ollama，并让 WeKnora 使用容器网络地址。
- 推送模型镜像到用户现有阿里云北京 `agentearth` 私有仓库，打开远端镜像版本页供检查。
- Seal 设置新增 WeKnora 项，按用户选择打开 WeKnora 原生模型配置页，以其现有能力管理外部 Embedding 模型。
- 保留既有插件源码与用户状态，不修改 DSH 上游实现，不提交或推送 Git。

## Acceptance Criteria

- [x] WeKnora 应用可从容器网络访问 Ollama；仅列出向量模型，768 维向量请求成功。
- [x] 宿主机 Ollama 已停止；切换前后同一知识库检索结果一致。
- [x] Seal 设置页中 WeKnora 入口可见，按钮打开 WeKnora 原生模型设置 URL；产品检查通过。
- [x] 阿里云镜像推送完成，远端 digest 可核验并在右侧显示；旧 14B 标签不存在。

## Notes

本机 Docker 内 Ollama 向量化已通过，但 GPU 检测结果为 CPU；同版本官方容器也如此。GPU 兼容性不作为本次镜像交付的必要条件，需在将来另行处理宿主驱动与 Docker 运行环境。最终镜像只含向量模型，远端摘要为 `sha256:60d88819cbeebe59562f2d817ad26314592a4651fbcfc2c26b56f0a981681b52`。
