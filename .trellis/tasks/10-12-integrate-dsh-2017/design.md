# 分阶段适配设计

1. **基线**：抓取上游 `7abe94dd`（DSH Desktop Beta 2.0.17-beta.2）和其记录的内核 `d743267`（0.2.1-alpha.2）。把当前本地产品覆盖与上游共享目录差异列成矩阵，不做整树强制合并。
2. **独立安全修复**：先移植旧 Profile junction 清理，Stable/Beta 同步；必要时追加 Windows ACL 沙箱、Linux AppImage 和 macOS 权限的独立阶段。每阶段完成定向测试再提交。
3. **内核 pin 与运行时**：更新 `deepseek-harness/` gitlink、`upstream.json`、`vendor/dsh-runtime` 的对应发行包及根 Yarn 锁文件，单独提交。源码子模块保持只读。
4. **共享 Desktop 适配**：从新版 Desktop 提取 Profile/Host/插件包服务和其真实依赖，优先保留本仓库产品配置接缝，不恢复上游登录与更新行为。Beta 验证后镜像 Stable；Next 仅在其依赖声明必须对齐时处理。
5. **产品插件适配**：测试身份、SQLite、专家、技能、连接器、定时任务与资源页对新版公开 API 的兼容性；对变化的接口做最小修改。
6. **验证与发布边界**：先 headless build/type/test/Profile，再进行 Windows 图形启动和未签名解包；macOS/Linux、签名与覆盖升级单独标记。失败阶段不伪报完成，不推送。

上游与当前 ZIP 迁入的下游没有共同 Git 祖先；不能用普通 `git merge dsh-upstream/master` 代替逐文件/逐提交适配。用户数据目录不参与源代码迁移。
