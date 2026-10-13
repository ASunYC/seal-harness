# 整合 DSH Desktop 近期更新和新内核

## 目标

把近期 DSH Desktop Beta 2.0.17-beta.2 中适用于 Seal Harness 的修复与新版插件包服务整合进本仓库，同时按用户明确授权升级固定的 DeepSeek Harness Beta 内核到 0.2.1-alpha.2。

## 产品边界

- 保留 Seal Harness 品牌、本地登录、SQLite 专家/技能/连接器、定时任务及现有产品插件。标题栏与打包版本继续取 Seal Harness 自己的 manifest；不接社区 Desktop 更新渠道。
- 不把上游不相关的 Next 实验壳、上游身份产品流程或已删除项目/知识库/智能体插件恢复到产品 Profile。
- 固定内核子模块只改变 Git pin，不在其 checkout 修改文件；pin 与共享 Desktop/产品行为分别提交。
- Stable/Beta 共享实现按 Beta 先行、双变体同步和相关验证。供应链来源、LFS、许可证与独立 Home 保留。
- Windows/macOS/Linux 各平台的构建、启动、安装及升级分别报告实测结果；本机通过不等于跨平台通过。不推送或发布。

## 验收

- [x] 上游目标提交、pin、运行时 tarball、根锁文件与插件声明版本对齐；Seal Harness 活动 Profile 不混用旧/新内核。Next 实验壳保留其独立来源和运行时 pin。
- [x] 最新版插件包服务在实际产品 Profile 中激活；本地插件、专家、技能等组合检查通过，原生对话界面健康启动。真实模型回复仍由用户在已有凭据下检查。
- [x] 旧 Profile junction 清理等已选修复按独立补丁移植，现有 Seal Harness 产品检查无倒退。
- [x] 产品构建、类型、产品测试、双变体、布局与 Profile 实际启动检查通过；差异和未测试平台记录完整。

## 授权

用户已明确选择“连同内核和新版插件服务一起升级”。该授权覆盖固定内核的跨次版本升级和必要兼容修改，不自动授权 Seal Harness 自身主/次版本号升级、推送或发布。
