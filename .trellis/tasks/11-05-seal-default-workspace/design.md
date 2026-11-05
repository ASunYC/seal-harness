# 设计

DSH `@deepseek-ai/dsh-api-workspace-controller` 0.2.1-rc.5 在 `defaultWorkspaceDirectory` 里固定拼接 `deepseek-harness`。公开的 `documentsDirectory` 只替换系统 Documents 根，无法改变产品目录。仓库的 0.1.7-alpha.2 Yarn patch 已针对同一问题将该片段改为 `seal-harness`；沿同样方式给 rc.5 的 `lib/index.js` 和 `lib/types/default-directory.js` 打最小包补丁，维持其余上游行为。

`WorkspaceRegistry.initializeDefault` 只对空历史创建一次默认工作区。当前旧目录虽然为空，但 `~/.seal-harness/sessions/` 有基于旧路径的会话，所以不得把现有注册记录或会话路径直接改写。先完成新安装默认路径，再通过现有工作区创建/选择流程处理本机当前显示路径；旧工作区保留历史。
