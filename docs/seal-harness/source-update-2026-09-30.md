# 2026-09-30 来源工程差异整合

来源为用户更新的 `D:\git-workspace\AI\zhizuo-master\zhizuo-master`。该目录没有 Git 元数据；比较时将 `geovis-zhizuo-desktop/`、包名和产品服务名映射到 Seal Harness，再以当前工作树为基准盘点。源目录和同名 ZIP 在本次检查时内容一致。

## 已整合

- 资源页统一同步状态与刷新交互，修复导航顶端间距，并为商店、技能、连接器、专家、知识库和智能体更新对应展示。
- 连接器加入 CodeGraph 旧版包装包的工作区启动适配、目录图标、编辑和详情交互；MCP Center 目录及 Logo 使用校验后的本地快照。
- 会话输入区新增可搜索技能浮层，按来源分组并插入精确技能命令；已归档会话新增带确认的永久删除，Host 校验活动状态和存储路径，失败时回滚。
- 品牌插件补充原插件管理页的同步提示。Windows 开发版启动时仅归档目标路径和 AppUserModelID 都匹配的冲突 `Electron.lnk`。
- Beta 固定版本工作区包通过 Yarn patch 将默认新工作区目录改为 `seal-harness`，保持上游子模块只读。
- 系统默认 Persona 明确使用 Seal Harness 产品身份。

## 保留的本产品边界

`product.json`、全部海豹图标、默认不连接旧 Geovis/内网服务的配置、登录页图标、本地工作台入口、Windows 测试适配和本仓库 README 均沿用已有 Seal Harness 版本。来源中的旧 Trellis 任务、个人截图绝对路径、废弃补丁档案和旧产品图标没有迁入。第三方服务域名和镜像引用作为外部协议来源保留，不作为 Seal Harness 默认服务地址。

自动化验证见 [`validation.md`](validation.md)。来源的视觉 QA 结论不能替代当前产品在真实 Electron 窗口中的视觉验收。
