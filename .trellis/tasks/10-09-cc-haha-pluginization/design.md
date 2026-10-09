# 设计：能力分层与装配路径

## 一、装配机制（已实测确认）

Profile 组合的权威顺序由 `@deepseek-ai/dsh-app-boot` 决定：

```
bundle 层（按 dsh.profile.bundles 顺序）
  ① @deepseek-ai/dsh-base        → cordis.patch.yml（92 行 insert，Host 能力底座）
  ② @deepseek-ai/dsh-web-app     → cordis.patch.yml（81 行 insert，浏览器界面名册）
↓
profile 用户层   <profileDir>/cordis.patch.yml
↓
Desktop 自有叠加层
  · dsh-plugin-desktop-beta 的 cordis.patch.yml（desktop-shell/terminal/diagnostics/…）
  · product profile 的 cordis.patch.yml（seal-harness-desktop，产品插件 insert）
```

- 活动 profile 模板固定为 `web = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`（`dsh-app-boot` 的 `PROFILE_TEMPLATES`）。产品不自建模板。
- 后续层按 `id` 覆盖前层整行 `config`，可用 `insert` 追加新行。因此**产品 patch 层可以 insert 官方包**，前提是该包能被 profile 解析。
- 官方仅发布两个可选 bundle 常量 `OPTIONAL_BUNDLES`：`dsh-experimental-agent-team-profile`、`dsh-experimental-voice-input-bundle`。二者各自自带 `cordis.patch.yml`，是「一次启用一组成套能力」的现成入口。

## 二、依赖解析来源（已实测）

- 根 `package.json` 的 `resolutions` 有 1148 条 DSH 条目，把 `@deepseek-ai/dsh-*` 的 npm 版本重定向到 `file:vendor/dsh-runtime/0.1.7-alpha.2/<tarball>`。
- 因此**任何 vendored 包都能被解析**，无需新增网络依赖。
- 物理安装位置为 `dsh-plugin-desktop-beta/node_modules/@deepseek-ai/`；`seal-harness-desktop` 通过 `linkProductDependencies()` 建 junction 复用，不另建锁文件。
- 结论：新增装配项 = profile patch 层加 insert 行 + 确认包已物理安装。未安装者在 `dsh-plugin-desktop-beta` 的 `dependencies` 补声明后重跑 `yarn install`。

## 三、能力真实分层（实测结果，取代初版估算）

初版手册按「vendored 目录存在」估算，实测后必须修正：**25 项已装配，6 项已安装未装配，9 项可添加，0 项不可用**。

### 已装配（25 项，无需改动，仅需实测可用性）

Deliverables UI、Jobs UI、权限档位 UI、Plan UI、定时任务 UI、SubAgent 设置 UI、BrowserUse 侧栏、终端 UI、SubAgent UI、轨迹 UI、用户提问 UI、工作流 UI、上下文压缩、Jobs Host、MCP 资源、权限档位 Host、Plan 模式、会话查询、会话引用、会话统计、SubAgent Host、Token 计量、Jobs 工具、工作流工具、工作区变更。

**但「已装配」不等于「可用」**，存在三类折扣，必须逐项实测：

1. **配置级关闭**：`session-query-sqlite` 在 `dsh-web-app` 里配 `path: ':memory:'` + `openAt: never`（注释明确写着全文搜索是 opt-in）。全局搜索需要覆盖为 `openAt: first-search`。
2. **Host 已在、入口未见**：工作流 Host 与 UI 都在，但需要确认在一级导航或会话内的实际入口，产品当前导航只有首页/问问决策/空间/定时任务四项。
3. **需模型工具驱动**：Workflow、Agent Teams 依赖模型主动调用工具，静态装配不产生可见界面。

### 已安装未装配（6 项，装配成本最低）

| 能力 | 包 | 说明 |
| --- | --- | --- |
| 终端 Host | `dsh-terminal` | UI 已在，Host 缺失 |
| MCP Host | `dsh-mcp-client` | 资源已在，客户端缺失 |
| 工作流 Host | `dsh-workflow` | 工具与 UI 已在，编排运行时缺失 |
| AgentTeams Host | `dsh-experimental-agent-team` | 缺配套工具与 UI |
| AskUser 工具 | `dsh-tool-ask-user` | 提问 UI 已在 |
| 语音转文字 | `dsh-experimental-speech-to-text` | 需配 bundle |

### 可添加（9 项，需先补依赖声明）

`dsh-experimental-agent-team-profile`（含 Host+工具+UI 三件套）、`dsh-experimental-voice-input-bundle`、`dsh-browser-use`、`dsh-experimental-browser-use-runtime`、`dsh-computer-use`、`dsh-experimental-computer-use-cua-driver-native`、`dsh-schedule`、`dsh-experimental-client-ui-agent-team`、`dsh-experimental-tool-agent-team`。

## 四、插件边界

按界面区域划分，与 `docs/seal-harness/cc-haha-plugin-migration.md` 第三节一致。导航由用户自有结构承载，插件只通过 `sealHarnessNavigation` 注册 `id`/`label`/`order`。

产品插件四层结构固定：`src/index.js`（Host）+ `src/module.js`（业务与 RPC 动作）+ `src/client.jsx`（Client）+ `src/panel.jsx`（React），测试放 `tests/`。共享装载器复用 `plugins/capability-shared/src/{host.js,client.jsx}`，不重写 RPC 注册、样式注入与导航注册。

## 五、兼容与回滚

- 所有改动局限在产品自有路径：`seal-harness-desktop/`（patch 与插件）、`dsh-plugin-desktop-beta/package.json`（仅在需要补依赖时）。
- 装配项逐个 insert，可按 id 单行回退。
- 不修改 `deepseek-harness/`；不改动共享 Desktop 行为，因此不触发 Beta/Stable 双变体镜像同步。
- 阶段 1 每批一次提交，便于二分定位。回退 = 撤销该批 patch 行。

## 六、未决问题

- 已装配的 25 项中，哪些在兼容模式外壳下真正渲染，需要真实 Electron 窗口确认，不能靠单测推断。
- H5 远程访问与公网暴露涉及安全边界，需单独设计，不在本阶段范围。
- 桌面宠物需要新的 Electron 透明窗口与 preload，DSH 的 `ElectronShellGeneration` 独占窗口生命周期，需评估是否有公开接缝。
