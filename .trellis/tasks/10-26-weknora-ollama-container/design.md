# 设计

- 使用独立的 WeKnora Compose 覆盖文件加入 Ollama，并覆盖应用的 `OLLAMA_BASE_URL=http://ollama:11434`。GPU 作为可选覆盖文件；服务端口仅绑定本机回环地址。
- Ollama 镜像从官方固定摘要复制 Linux 程序、CPU 与 CUDA 12 运行库；构建脚本只挑选 `nomic-embed-text` manifest 引用的 blobs。镜像内不加入问答 LLM、WeKnora 数据卷、环境文件或访问令牌。
- Seal 继续使用原版 `dsh-weknora` Host 工具。新 Client 产物名为 `settings-client.js`，避免覆盖上游 REST `client.js`；通过公开的 `settings.section` 槽提供 WeKnora 设置入口。
- 外部 Embedding 提供商、维度和密钥仍由 WeKnora 原生模型设置管理，Seal 仅生成经过协议校验的管理页链接。
