# 实施顺序

1. 增加 SQLite 前向迁移与旧库测试；验证旧数据保留和新表约束。
2. 增加组织 Host 服务与 RPC；验证层级、人员、账号隔离及错误边界。
3. 增加 Client 页面与独立导航注册；验证创建、编辑、搜索和选择流程。
4. 将插件加入产品构建和 Profile；运行相关单测、产品 build/check、差异检查。

## 完成与验证

- Host/Client 插件已接入产品构建、Profile 和导航；公司、部门、人员资料由本机 Host SQLite 与 RPC 管理。
- `corepack yarn seal-harness:build` 通过；`corepack yarn seal-harness:check` 通过，包含组织服务、RPC、页面和产品装配测试。
- `git diff --check` 通过；独立 Chromium 页面冒烟已覆盖加载和目录选择。
- 尚未在正式安装的桌面程序中手动点验，也未进行 macOS/Linux 图形端测试。
