# 设计

## 边界

现状：导航插件在首页覆盖 `sidebar.workspaces`，把上游 `WorkspaceBrowser` 隐藏；“空间”主面板重复展示工作区。需要保持上游侧栏的原生浏览器，让产品资源入口与它并列。

## 实现

- 首页资源通过上游公开 `sidebar.panellist` 注册为侧栏行，顺序位于原生 `sidebar.workspaces` 之前。资源对应的 `main` keyed panel 由同一注册生命周期提供；原生插件管理沿用 `plugins` 主面板。
- 原生 `sidebar.workspaces` 在首页及资源页不覆盖，保留完整的上游会话树和行操作。仅空间/定时任务模式可按当前约定显示空态。
- 导航插件只依赖其实际使用的 slots/layout/sidebar，避免等待工作区服务初始化后才注册导航；工作区服务依旧自行管理原生浏览器。
- 现有 `sealHarnessNavigation` 服务仍支持资源插件注册与会话输入框快捷入口，保持 Home keyed panel 作为兼容入口。
- “空间”主面板去掉工作区枚举与新增交互，仅提示功能待定义；不会更改数据和工作区服务。

## 验证

导航单测覆盖各模式的 slot 注册、资源主面板及原生 slot 恢复。产品构建和检查后，用隔离 Home 的 Windows Electron 窗口核对菜单、工作区、会话和资源切换。
