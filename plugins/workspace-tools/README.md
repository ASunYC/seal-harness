# @seal-harness/workspace-tools

提供文件读取、写入、精确替换、目录创建、文件列表、文本搜索和 Shell 工具。
文件工具强制限制在真实工作区路径内并拒绝符号链接逃逸；Shell 始终标记为
`dangerous`，由 Policy/Approval 决定是否执行。
