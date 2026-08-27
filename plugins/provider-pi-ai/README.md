# @seal-harness/provider-pi-ai

使用 `@earendil-works/pi-ai` 实现标准 `ModelService`。内置 Provider 集合直接跟随当前
安装的 pi-ai 完整模型目录，Profile 只注册明确选中的 Provider；默认仅注册 DeepSeek，
不主动刷新网络模型目录。
