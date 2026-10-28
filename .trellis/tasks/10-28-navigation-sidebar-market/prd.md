# 调整一级导航与首页侧栏布局

## Goal

宽侧栏仅首页显示，插件市场提升至空间之后的一级导航，保持原生面板与用户收起偏好

## Requirements

- 红框宽侧栏仅在首页（含首页的专家/技能/连接器/插件等资源页）显示；问问决策、自动化、空间、插件市场及账号页不留空白侧栏。
- 插件市场放在空间之后的一级导航中，作为主内容页展示；移除旧侧栏底部入口。
- 通过公开 Slot 复用现有市场页面及其语言/配置注入，不修改市场业务和继承的 Desktop/只读子模块。
- 保留首页的侧栏宽度和手动收起偏好、原生会话与右栏；非首页隐藏仅影响本次布局，设置和账号仍可打开。
- 保留前一任务尚未提交的反馈移除改动；不提交、推送、发布。

## Acceptance Criteria

- [x] 首页与决策/自动化/空间/市场切换时，宽侧栏按要求显示/隐藏且内容区收回空间。
- [x] 市场一级菜单在空间后，进入现有市场内容页；旧底部入口不可见，插件晚加载/卸载时可正确接入/清理。
- [x] 首页原生会话、资源页、手动收起与设置/账号入口回归通过。
- [x] 产品 build/check 通过，并完成 Windows 桌面实际布局检查；记录未验证平台范围。

## Change Boundary

行为在产品 navigation Client 及样式中。预计修改 `plugins/navigation/src/client.jsx`、`styles.js`、`tests/client.test.mjs` 和桌面契约。通过公开 `settings.plugins.tab` 注册取得市场组件及注入元信息，投影为产品 keyed main 页面；不深度导入市场源码。布局让非首页主内容跨过原侧栏轨道，侧栏本身裁为零宽，保留其挂载和设置注入，不覆写持久化的收起/宽度状态。此任务无需局部重构或新的公共服务。

## Validation

- 完整产品 build/check 通过，日志 `.build/navigation-build.log`、`.build/navigation-check.log`；真实 Profile 的 standard 会话、24 个浏览器 MCP 工具、Creator、插件管理器及两轮 HMR 均通过。
- 导航 Client 测试覆盖决策普通会话往返、首页资源、市场晚加载/卸载、元信息注入及非首页设置入口；不调用侧栏 toggle。新增市场内容边距后再次完整 build，并复跑导航两个测试，全部通过。
- 真实 Chromium 布局夹具覆盖兼容/扩展/高级 × 宽/窄窗口 × 展开/收起，共 12 组：非首页侧栏为零宽、主内容紧邻一级导航、右栏位置不变、固定设置面板可交互、首页原布局完整恢复。脚本 `.build/check-navigation-columns.mjs`。
- Windows Electron 重启后 `rendererStatus: healthy`。实测空间、自动化、市场的侧栏均为 0px，内容左边界为一级导航末端 56px；回首页后宽侧栏恢复 280px，原 grid 与 collapsed 状态一致。市场已渲染现有目录，旧底部按钮不可见。
- 实测市场页可打开 800px 宽的设置弹窗并用 Escape 关闭，账号页无空白侧栏，最后返回首页。市场截图 `.build/navigation-market-qa.png`。
- `git diff --check` 通过；没有更改继承的 Desktop/市场源码或用户配置，没有执行插件安装、模型提示词或真实反馈提交。macOS/Linux 图形端未实测，平台布局夹具不能代替目标平台验收。
