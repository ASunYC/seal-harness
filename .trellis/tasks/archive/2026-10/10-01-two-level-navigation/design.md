# 两级导航方案

## 技术边界

产品通过 DSH 的公开 `shell.overlay`、`sidebar.workspaces`、`main`、`layout` 和现有 Client 插件组合实现导航。上游的 `sidebar.panellist` 把每项视作平铺面板，无法直接表示父子关系；所以产品层新增一个导航插件，在 `shell.overlay` 绘制常驻一级窄栏，并只在首页/定时任务模式用高优先级 `sidebar.workspaces` 注册二级区域；对话/空间模式释放覆盖，让原生工作区浏览恢复。原生对话、工作区浏览和输入框继续由 DSH 拥有。

`D:\git-workspace\AI\codex` 当前 checkout 不包含截图所示桌面 UI 的渲染源码。参考截图的窄栏节奏、层级与密度，但不移植 Codex CLI/app-server 实现或产品标识。

## 导航与注册

- 新建 `seal-harness-desktop/plugins/navigation/` 产品插件，在 Client 的 `shell.overlay` 注册左侧窄栏，并在 `main` 注册“首页”“空间”“定时任务”面板，包不加入根 Yarn workspace。
- 新增产品 Client 服务 `sealHarnessNavigation`：资源插件在自身生命周期内注册 `{id,label,order,icon,Panel}`；注销时从首页二级列表移除。服务维护当前二级选择，首页顶级面板保持激活，切换子页不重建 DSH 会话。
- 专家、技能、连接器继续独立拥有 Host/RPC、数据和 React 内容，仅改变 Client 导航注册点；`capability-shared/registerPanel` 集中处理。优先在各 Client 入口用服务注入保证 HMR 加载顺序。
- 首页在 `sidebar.workspaces` 位置显示二级菜单和概览；主区域渲染选中资源页。子页沿用现有内容和操作，逐步统一标题/间距/颜色。页面内“返回”回首页概览，一级导航可回到原生对话。
- 原生插件管理当前是独立 `sidebar.panellist` 入口，先保留其功能与当前生命周期；设置和账号入口仍在底部，不通过 DOM 隐藏来伪装它们已归入首页。

## 视觉和交互

参考 Codex 截图：深色中性色为背景，一级入口图标与选中态明确；二级栏由 DSH 原生 sidebar 列承载并可滚动；主内容继续使用 DSH 主题变量。产品样式为 `.dshDesktopFrame` 左侧预留窄栏宽度，`shell.overlay` 中的窄栏覆盖该留白；仅侧栏拖拽线补偿同样宽度，不修改 DSH 源码。键盘可聚焦、按钮有可读标签。窄窗口时二级栏随原生侧栏折叠，不覆盖输入框或标题栏。Windows/macOS/Linux 的标题栏安全区分别核对。

## 空间与定时任务

空间首版复用现成的 DSH 原生工作区服务，展示、创建或打开现有工作区及其会话入口。定时任务首版仅提供可见入口和明确空态，不新增数据模型、调度器或假任务；Codex checkout 的 app-server 协议类型不能作为 Seal Harness 的执行器。

## 验证与回退

定向 React/Cordis 测试覆盖入口分组、子项切换、插件卸载清理、返回对话、键盘操作和窄视口；产品构建、Profile HMR、布局检查与 Windows 实际窗口截图验证。保留当前插件源码和数据，不迁移 SQLite。回退只需恢复注册方式与移除新导航包。
