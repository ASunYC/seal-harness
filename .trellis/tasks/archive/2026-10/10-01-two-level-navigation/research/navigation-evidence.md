# 导航现状与参考边界

- 用户参考图展示 Codex 桌面应用的窄图标栏、旁侧内容栏与主会话区域。`D:\git-workspace\AI\codex` 当前仓库可查到 CLI、TUI、app-server 协议及桌面启动工具，未找到截图中桌面侧栏的渲染源码；因此把截图用作交互和视觉参考，不复制桌面代码。
- Seal Harness 的专家、技能、连接器 Client 均调用 `capability-shared/src/client.jsx#registerPanel`，每个插件直接注册一个 `main` 和一个 `sidebar.panellist`，所以现在在一级侧栏平铺。
- DSH `ui-sidebar/SidebarRoot.tsx` 将 `sidebar.panellist` 当成全局平铺面板列表；点击行调用 `layout.selectPanel(id)`。`sidebar.workspaces` 是单项 slot，承载原生工作区/会话浏览。Desktop `AdvancedFrame.tsx` 保留 `sidebar`、`main`、`rightbar`、`shell.overlay` 四个公开 slot。
- 当前产品品牌插件已通过 `sidebar.panellist` 的 priority 覆盖插件管理图标与顺序。原生插件管理是独立一级入口，移入“资源”需另行处理上游入口，不应通过隐藏 DOM 伪装完成。
- 可在产品层新增资源导航插件，让它独占一个顶级“资源”入口及主面板；专家/技能/连接器仍独立提供 Host/Client 功能，但改由资源导航注册二级页面。切换资源子页时顶级入口仍保持选中，原生会话与工作区不重建。
- 真正把 Codex 的独立窄栏常驻在 DSH 原生侧栏左侧，当前没有专用公开 slot；通过 `shell.overlay` 和 CSS 挤压 Desktop 列布局会影响缩放、拖拽、标题栏和三平台。首版宜先验证产品级两级路由，不直接复制整个上游 sidebar。

用户已明确第一级保留当前对话，新增“首页”“空间”“定时任务”；专家、技能、连接器进入首页的第二级菜单。当前 DSH 有成熟的原生工作区/会话浏览，但未查到现成的产品定时任务模块。`D:\git-workspace\AI\codex` 的 app-server 协议含 ScheduledTaskSummary 类型，但不能直接提供截图中的 Desktop 自动化 UI 或 Seal Harness 任务执行服务。
