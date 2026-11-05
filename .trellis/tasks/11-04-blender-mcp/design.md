# 设计

通过既有 `@seal-harness/connectors` 的系统目录提供内置入口。目录定义放在 Seal 产品代码中，与只读的 cc-haha 快照分开；安装仍调用现有 `installCatalog`、凭据存储、MCP 子插件和会话工具限制。

本机程序只使用已安装的 `uvx`。运行 `uvx --python 3.11 --from mcp-for-blender==2.2.6 mcp-for-blender install-addon`，由上游负责 Blender 用户插件的备份和复制。安装成功后记录 `uvx` 绝对路径与同版本的 MCP 启动参数。默认 disabled，避免在 Blender 尚未启用插件时呈现可用状态。插件安装会影响当前系统用户下的 Blender 插件目录，目录卡片明确说明。

来源：`https://github.com/ahujasid/mcp-for-blender`，检查提交 `992233bb258975a05eec8b5691465c50c2831e34`，PyPI 版本 `2.2.6`，MIT。真实 Blender 不随 Seal 分发。
