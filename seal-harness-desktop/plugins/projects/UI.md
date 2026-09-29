# 项目界面迁移

来源 Stratex `c656400bc4baf80733a9ac5d8a1440539126c7e0`，原 package.json 声明 `UNLICENSED`，不改变许可。原文件 SHA256 见 `stratex/renderer/source-manifest.json`。源码沿原相对目录保留。

## 已迁入范围

| 入口 | 保留的业务 |
| --- | --- |
| 项目列表 | 搜索、创建、加入、归档切换与详情入口 |
| 动态 | 动态列表、项目引用、成员活动 |
| 里程碑 | 里程碑、迭代、列表/看板/甘特、生命周期及关联工作 |
| 需求 | 分页查询、字典、详情、认领、提报、父子关系及门禁 |
| 任务 | 表格/看板/日历/时间线、层级、批量操作、协作、规格辅助 |
| 测试 | 测试轮次与需求测试流程 |
| 群聊 | 历史、未读、搜索、项目引用 |
| 会话 | DSH 项目会话列表、打开原生会话、规划草案查看/审核/丢弃 |
| 资产 | 文件、版本、预览、回收站、上传/取消/续传、下载 |
| 项目管理 | 成员、邀请、设置、约定、提交门禁、数据源、通知设置 |

## 宿主适配

标准 DSH main/sidebar slot 挂载独立 Vue、Pinia、memory router。编译 CSS 由根构建注入 `__SEAL_HARNESS_PROJECT_CSS__` 后放入 ShadowRoot；主题、密度、弹层、Esc、搜索快捷键和焦点恢复局限项目节点。浏览器原生文件选择、下载和通知使用 Host 提供的 bridge。图标改为本地静态 SVG，剪贴板使用浏览器 API，不依赖旧 Electron preload。

唯一 SSE 和 bridge 随 Client 插件存活，因此切到 DSH 会话仍接收项目通知。通知点击打开项目面板及对应详情；加入链接也能唤起面板。`project:account-changed` 严格接收 `{accountId,epoch}`，切号中止旧 RPC、释放旧 bridge 并重建 Vue。面板卸载撤销页面订阅、定时器、主题观察和 Pinia；异步挂载支持中途取消。偏好数据以账号命名空间隔离。

旧会话 composer 替换为项目输入区：先绑定 DSH 工作区，再创建原生会话并由 Host 发送一次输入。原生会话负责模型、工具和消息展示。工作区入口可选择已存在的 DSH 工作区，或通过 Host 原生选目录绑定；不把路径伪造成工作区 ID。规划草案使用真实 Agent 事件刷新。

## 已验证与边界

`node --test seal-harness-desktop/plugins/projects/tests/ui/island.test.mjs` 编译并挂载真实页面，验证列表搜索、八页签切换、会话列表、局部弹层/Esc还焦、订阅释放、迟到响应以及挂载中途取消后重挂载。独立 worktree 可用 `SEAL_HARNESS_UI_DEPS` 指向已安装依赖的根，不安装第二套依赖。

`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p seal-harness-desktop/plugins/projects/tsconfig.client.json` 检查 Client、隔离容器及完整迁入的 Vue 业务树，保留来源严格空值、可选属性、未使用声明及数组索引检查。使用根 Vue/TypeScript 和产品复用的 Desktop 类型，不扩展到 Stratex 旧桌面。主题跟随 DSH 的 `body[data-ds-dark-theme]`，DOM 检查覆盖主题变化及项目内搜索快捷键。

本检查使用协议边界夹具，证明页面编译和上述交互，不代表全部业务写入、后端账号、Agent 执行、浏览器通知权限或 Electron 视觉验收通过。这些由集成阶段分别验证。

项目图标直接渲染 Lucide SVG 节点，取自 Desktop 已安装的 lucide-react 1.33.0，许可保留在 `stratex/renderer/src/components/ui/lucide-LICENSE`。只保留项目使用的名称，不引入动画或图标运行库；日历、时间轴也有对应图形。项目原生对话和侧栏状态逻辑保持现有实现。
