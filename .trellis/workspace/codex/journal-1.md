# Journal - codex (Part 1)

> AI development session journal
> Started: 2026-09-24

---


## Session 1: Seal Harness 迁移与品牌接入
<!-- trellis-session: v=2 fp=338503954bb53223 -->

**Date**: 2026-09-29
**Task**: Seal Harness 迁移与品牌接入
**Branch**: `codex/seal-harness-migration`

### Summary

迁入下游源码，复用 DSH Desktop 产品装配，统一身份并生成海豹图标。

### Main Changes

- 重建产品包名、Cordis 插件名、应用 ID、数据目录与 CI。
- 默认关闭来源工程远端服务，保留本地工作台入口。

### Git Commits

| Hash | Message |
|------|---------|
| `3aaca3d` | feat: 迁入并重塑 Seal Harness 桌面工程 |

### Testing

- [OK] seal-harness:build 与 seal-harness:check 通过。
- [OK] check:layout、typecheck、git lfs fsck 通过。

### Status

[OK] **Completed**

### Next Steps

- 原生安装、图形启动、签名和升级在目标平台验证；推送需用户授权。


## Session 2: 整合更新的来源工程差异
<!-- trellis-session: v=2 fp=cf39870362ada962 -->

**Date**: 2026-09-30
**Task**: 整合更新的来源工程差异
**Branch**: `codex/seal-harness-migration`

### Summary

按规范化差异整合更新的资源页、连接器、会话选择器与工作区补丁，并保留 Seal Harness 品牌和海豹图标。

### Main Changes

- 新增技能候选浮层、永久删除已归档会话、资源同步提示及 MCP Center 缓存。
- 更新 Windows 开发快捷方式处理和 Beta 默认工作区目录。

### Git Commits

| Hash | Message |
|------|---------|
| `e67dcc8` | feat: 整合更新功能并保持 Seal Harness 品牌 |

### Testing

- [OK] yarn install --immutable、seal-harness:build、seal-harness:check 通过。
- [OK] check:layout、typecheck、git lfs fsck、git diff --check 通过。

### Status

[OK] **Completed**

### Next Steps

- 实际 Electron 视觉与原生安装在目标平台验收；推送需单独授权。


## Session 3: Seal Harness 本地登录与 SQLite 产品数据
<!-- trellis-session: v=2 fp=6fad09952353b061 -->

**Date**: 2026-09-30
**Task**: Seal Harness 本地登录与 SQLite 产品数据
**Branch**: `codex/seal-harness-migration`

### Summary

完成本地账号登录、共享 SQLite 项目专家技能持久化，移除企微、知识库及产品智能体，并保留海豹品牌。

### Main Changes

- 首次管理员和本地密码登录；SQLite 表、迁移与按用户隔离；本地项目与原生对话。
- 专家和技能包写入数据库，旧基础 Home 文件复制导入；清理旧插件与构建装配。

### Git Commits

| Hash | Message |
|------|---------|
| `e4f33b6` | feat(seal-harness): move core product data to local SQLite |
| `864c659` | chore(task): archive 09-30-local-sqlite-product |

### Testing

- [OK] seal-harness:build、seal-harness:check、check:layout、typecheck、git lfs fsck、git diff --check 通过。

### Status

[OK] **Completed**

### Next Steps

- 真实 Electron 窗口、安装包、签名升级及 macOS/Linux 在目标平台验收。


## Session 4: 移除 Seal Harness 项目插件
<!-- trellis-session: v=2 fp=3126724e9aaf90a4 -->

**Date**: 2026-10-01
**Task**: 移除 Seal Harness 项目插件
**Branch**: `codex/seal-harness-migration`

### Summary

删除项目插件、侧栏入口、旧装配包及项目插件测试；保留用户目录和 SQLite 历史记录。

### Main Changes

- 清理 Cordis Profile、构建与打包清单，更新当前文案和工程契约。

### Git Commits

| Hash | Message |
|------|---------|
| `e645f9d` | refactor(seal-harness): remove product projects plugin |
| `5b220b9` | chore(task): archive 10-01-remove-project-plugin |

### Testing

- [OK] seal-harness:build、seal-harness:check、check:layout、git diff --check 通过；应用已重启。

### Status

[OK] **Completed**

### Next Steps

- 无需迁移数据；如需彻底清理历史 projects 表，应另行制定数据迁移方案。


## Session 5: 远程控制弹窗品牌名称
<!-- trellis-session: v=2 fp=624fc3b21e4e25bc -->

**Date**: 2026-10-01
**Task**: 远程控制弹窗品牌名称
**Branch**: `codex/seal-harness-migration`

### Summary

原生远程控制确认弹窗的中英文文案使用自定义产品名；上游默认文案保持原样。

### Main Changes

- Stable/Beta 同步以 DESKTOP_PRODUCT.name 组成远程控制提示，增加默认和定制构建回归。

### Git Commits

| Hash | Message |
|------|---------|
| `b084d8e` | fix(desktop): brand remote control confirmation |
| `8359dfa` | chore(task): archive 10-01-remote-control-offer-brand |

### Testing

- [OK] 两个变体各 11 项定向测试、两个类型检查、check:desktop-variants、check:layout、seal-harness:build 与 seal-harness:check 通过。

### Status

[OK] **Completed**

### Next Steps

- 如需视觉验收，可在应用中打开远程控制确认弹窗核对；不必启用远程控制。


## Session 6: Codex 风格两级桌面导航
<!-- trellis-session: v=2 fp=e13e98602120ce62 -->

**Date**: 2026-10-01
**Task**: Codex 风格两级桌面导航
**Branch**: `codex/seal-harness-migration`

### Summary

新增常驻一级窄栏与首页二级资源菜单；空间复用原生工作区，定时任务提供明确空态。

### Main Changes

- 专家、技能、连接器改由首页导航服务注册，修正会话输入框管理快捷入口；保留原生对话与数据。

### Git Commits

| Hash | Message |
|------|---------|
| `0ad2a89` | feat(seal-harness): add two-level desktop navigation |

### Testing

- [OK] seal-harness:build、seal-harness:check、check:layout、定向 React/注册测试通过；Windows 兼容模式实测深浅色和 760px 窄视口。

### Status

[OK] **Completed**

### Next Steps

- 请用户按截图评估视觉和栏目；macOS/Linux 原生窗口及安装包仍需目标平台验收。


## Session 7: 首页二级插件管理导航修正
<!-- trellis-session: v=2 fp=9eccbb2974eda243 -->

**Date**: 2026-10-02
**Task**: 首页二级插件管理导航修正
**Branch**: `codex/seal-harness-migration`

### Summary

按用户纠正导航：一级窄栏去掉对话按钮，插件管理与专家技能连接器并入首页二级菜单。

### Main Changes

- 复用原生插件管理主面板，隐藏旧侧栏行，并保留新会话入口。

### Git Commits

| Hash | Message |
|------|---------|
| `e61cc78` | fix(seal-harness): move plugins into home navigation |

### Testing

- [OK] seal-harness:build、seal-harness:check、check:layout 与定向测试通过；Windows 宽/窄窗口实测插件切换。

### Status

[OK] **Completed**

### Next Steps

- macOS/Linux 窗口及安装包仍需在目标平台验收。


## Session 8: 首页二级菜单改为会话与资源
<!-- trellis-session: v=2 fp=19f49a4f4497d68c -->

**Date**: 2026-10-06
**Task**: 首页二级菜单改为会话与资源
**Branch**: `codex/seal-harness-migration`

### Summary

移除首页概览和卡片；首页二级菜单直接显示会话、专家、技能、连接器、插件。会话与资源返回进入原生聊天，Windows 实际窗口验证通过；导航定向测试 11 项通过，产品完整检查受到同期独立插件测试失败影响。

### Git Commits

| Hash | Message |
|------|---------|
| `5c45823` | fix(seal-harness): show conversations in home menu |

### Status

[OK] **Completed**


## Session 9: Ask Jev 双决策模型 DSH 插件
<!-- trellis-session: v=2 fp=527d09ad25482597 -->

**Date**: 2026-10-06
**Task**: Ask Jev 双决策模型 DSH 插件
**Branch**: `codex/seal-harness-migration`

### Summary

完成独立 DSH bundle，并在 Seal Harness 中复用；支持 TypeSafe Jev 与阿里 decision-model-preview 的结构化决策。

### Main Changes

- Host-only credentials、双提供方固定端点、是非/选择/评分三模式、DSH 与 Seal 导航入口和独立安装包。

### Git Commits

| Hash | Message |
|------|---------|
| `40e6436` | feat(dsh): add portable Jev and Alibaba decision plugin |
| `c879637` | chore(task): archive 10-05-ask-jev-dual-decision-plugin |

### Testing

- [OK] 七项插件测试、隔离 DSH Web 安装与真实页面、产品构建/检查、根 typecheck/layout、immutable install 通过。

### Status

[OK] **Completed**

### Next Steps

- 真实 API Key/WorkspaceId 尚未提供；Windows 解包文件齐全但上游 dsh-fs-local BigInt smoke 失败，分发门禁需单独处理。


## Session 10: 首页恢复原生工作区与会话
<!-- trellis-session: v=2 fp=30b6d5d6b930c943 -->

**Date**: 2026-10-06
**Task**: 首页恢复原生工作区与会话
**Branch**: `codex/seal-harness-migration`

### Summary

首页用 sidebar.panellist 放资源入口，保留原生 workspace/session 浏览器；空间改空态。隔离 Windows 窗口实测专家、问问决策、插件与原生工作区同屏，工作区菜单可打开；产品构建、检查和布局检查通过。

### Git Commits

| Hash | Message |
|------|---------|
| `c14a34b` | fix(seal-harness): keep native workspaces on home |

### Status

[OK] **Completed**


## Session 11: 问问决策提升为一级导航
<!-- trellis-session: v=2 fp=2aa494b5be48b721 -->

**Date**: 2026-10-06
**Task**: 问问决策提升为一级导航
**Branch**: `codex/seal-harness-migration`

### Summary

产品导航将问问决策从首页资源行移至首页之后的一级 rail，打开原插件的独立决策页面。Windows 隔离窗口验证一级选中、独立页面和返回首页；产品构建、导航测试、产品检查与布局检查通过。

### Git Commits

| Hash | Message |
|------|---------|
| `d666b38` | feat(seal-harness): move decision to top-level navigation |

### Status

[OK] **Completed**


## Session 12: 设置与账号移至一级导航底部
<!-- trellis-session: v=2 fp=1e989ddc456fb868 -->

**Date**: 2026-10-06
**Task**: 设置与账号移至一级导航底部
**Branch**: `codex/seal-harness-migration`

### Summary

一级栏底部增加设置和账号图标，转发至原有设置弹窗与本地用户按钮，宽侧栏原按钮隐藏但保留挂载。Windows 隔离窗口实测宽/窄布局、设置完整弹窗和用户页；产品构建、导航测试、产品检查与布局检查通过。

### Git Commits

| Hash | Message |
|------|---------|
| `aba198d` | fix(seal-harness): move settings and account to primary rail |

### Status

[OK] **Completed**
