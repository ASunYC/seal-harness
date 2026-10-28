# 实现与验证

- 产品构建从选定 Beta Desktop 安装的 @deepseek-ai/dsh/package.json 读取 displayVersion，当前为 0.2.1-rc.2。产品 version 仍为 0.1.0。
- 现有 Desktop 产品配置接缝验证并传递 displayVersion；共用标题栏用它覆盖显示值，缺省保持 Host 版本。Beta 先改后镜像 Stable。
- 标题栏版本按钮、无障碍文案及悬浮版本内容共用 DesktopVersionControl 的 version 参数；兼容模式原生 chrome 和其他模式均使用该组件。
- 两变体各 13 项配置/真实 DOM 渲染测试通过；覆盖显示值变更、缺省值、非法配置及产品发布版本独立。
- Stable 首次在并行构建时出现既有 5 秒 Profile 加载截止及 worker 启动超时；停止构建竞争、改为单 worker 后原阈值通过。新增测试改用实际客户端挂载，避免在 jsdom 中使用服务端渲染和测试中首次导入整个 UI。
- 产品安装身份测试通过；完整产品构建通过。生成配置与构建收据含 displayVersion: 0.2.1-rc.2；普通客户端和兼容 chrome 产物均包含新配置；安装元数据仍为产品版本。
- 202 个共享源码镜像通过；子模块保持干净，差异空白检查通过。
- 全仓四个 workspace 类型检查通过，随后双变体镜像再次通过。未重新启动图形应用、未验证签名安装或其他系统。其他工作区改动保留，本轮不提交、推送或发布。
