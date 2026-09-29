# 桌面构建契约

## 范围与目录

根仓库直接继承 DSH Desktop，使用根 Yarn workspace。`deepseek-harness/` 是只读、固定提交的 pnpm 子模块。`seal-harness-desktop/` 是不加入根 Yarn workspaces 的产品自有包，承载身份、图标、品牌插件、标准 Cordis bundle/profile 和构建接入；真实独立功能才提取到根 `packages/`。不恢复旧构建副本、wrapper 或补丁装配流程。

优先复用上游公开服务、事件、slot 和插件组合。必须修改继承实现时，先在任务设计中记录接口缺口、最小影响面及升级验证；不深度导入上游 `src`，不另外安装一套 DSH 运行时。共享 Stable/Beta 修改仍按根 `AGENTS.md` 同步和验证。

## 命令

要求 Node `^22.19.0 || >=24.0.0`，Yarn `4.18.0`，通过 Corepack 执行。以下命令来自当前根 `package.json`：

| 用途 | 命令 | 边界 |
| --- | --- | --- |
| 初始化子模块 | `git submodule update --init --recursive` | 使用已记录 pin |
| 安装依赖 | `corepack yarn install --immutable` | 不自动改锁文件 |
| 编译 | `corepack yarn build` | 根上游包，headless |
| 类型检查 / 测试 | `corepack yarn typecheck` / `corepack yarn test` | 根上游包 |
| 完整检查 | `corepack yarn check` | 根完整 headless gate |
| Stable/Beta 同步检查 | `corepack yarn check:desktop-variants` | 修改共享 Desktop 代码时 |
| Next 检查 | `corepack yarn check:next` | 修改 Next 时 |
| 启动上游开发应用 | `corepack yarn dev` / `dev:beta` / `dev:next` | 图形启动需显式执行；不是Seal Harness启动验收 |
| 上游构建 | `corepack yarn upstream:build` | 根脚本进入子模块执行 pnpm |
| AA 发布准备 | `corepack yarn aa:prepare-release` | 按根发布规则记录产物与来源 |
| 上游发行 | `corepack yarn dist:mac` / `dist:win` / `dist:linux` | 对应平台；不是Seal Harness发行入口 |

产品根脚本已落地，实测范围见 `docs/seal-harness/validation.md`：`corepack yarn seal-harness:build`、`seal-harness:dev`、`seal-harness:start`、`seal-harness:check`、`seal-harness:package`、`seal-harness:dist:mac`、`seal-harness:dist:win`、`seal-harness:dist:linux`。Seal Harness使用 Beta 包承载 DSH 0.1.7-alpha.2；Stable 保持其上游版本。显式产品身份优先于运行时通道后缀，Seal Harness名称、应用 ID 和默认 Home 不随内核通道改变。执行前核对当前 `package.json`；命令未落地或未经实测时，不能宣称Seal Harness构建/打包通过。

产品目录包含自有 `package.json`、`src/client.jsx` 品牌插件、`assets/` 和 `scripts/`。品牌构建复用现有 `dsh-plugin-desktop-beta/node_modules` 的 tsdown、electron-builder 和 Electron。项目业务迁移所必需的 Vue 编译、Markdown 正文及文档解析依赖由根 `package.json` 和同一份 `yarn.lock` 固定，不引入第二套包管理器、锁文件或 DSH 运行时。新增依赖须对应真实产品功能，不能把来源应用的整套依赖搬入。产品构建产物装配到 Desktop 的 `node_modules/seal-harness-desktop` 与 `lib/product-assets`，通过标准 FileSet 纳入安装包。绝对必要的共享上游接缝先在 Beta 验证，再镜像 Stable，不绕开或弱化现有 layout gate。

账号、能力商店、技能、连接器、专家、项目及 Agent 分别装配为 `node_modules/@seal-harness/*` 插件，由产品 bundle 组合。`seal-harness:check` 包含 Host/Agent TypeScript、完整 Vue 类型检查、业务测试、文档 worker 和实际 Profile 启动检查；有未激活插件即失败。官方 ApiGateway 独占 `/api` RPC 拦截器，产品业务通过明确的 Connection Fetch 路径处理标准 RPC 信封，不注册第二个共享拦截器。

## 能力插件独立生命周期

1. **范围**：商店、技能、连接器、专家为 `@seal-harness/store`、`@seal-harness/skills`、`@seal-harness/connectors`、`@seal-harness/experts` 四个 Host/Client 插件，产品 bundle 默认组合，不互相强制依赖。
2. **入口**：Host 使用 `export async function apply(ctx)` 调用 `mountCapability(ctx, module, createModule)`。不要用可构造的普通函数返回 Promise，Cordis 会将其作为构造函数，导致初始化未完成即报告 ACTIVE。专家运行时从 `@seal-harness/experts/expert-runtime` 导出。
3. **契约**：共用源码在 `plugins/capability-shared/src`，构建内联，不注册总插件。各模块拥有独立实例、RPC、取消信号和界面清理。沿用 `POST /api/seal-harness-capabilities/<module>/<action>` 标准 RPC 信封及原数据/凭据键。商店安装通过该 RPC 调用对应插件。
4. **错误**：未通过 Connection 认证返回 401；信封无效或 method 不匹配返回 400；错误 Content-Type 返回 415；模块未加载或已卸载，其路由返回 404。业务错误仍返回原 `{ ok: false, error }`，客户端不得显示安装成功。
5. **场景**：默认加载四模块；单独卸载商店时，本地能力继续可用；卸载技能时，商店仍能浏览但不能安装技能；重新加载恢复原数据。坏例是停用一个模块同时清除其他模块路由或样式。
6. **验证**：`productPlugins` 驱动构建、装配和打包。各业务测试与 `capability-shared/tests` 覆盖真实 Cordis 独立加载、卸载、恢复及编译 Client。不得以目录拆开替代实际生命周期回归。
7. **禁止/正确**：禁止四个入口继续创建同一个聚合模块；各入口只挂载自己的业务。禁止移动或删除用户 Home 来适配包名；构建仅清理装配目录中的旧聚合包。

### 来源 UI 与只读预览

资源页样式以 `.zz-resource-page` 和插件自身根类隔离；结构迁移需要逐视图来源矩阵和实际桌面验证，不能以编译或样式注入代替。新增 React 交互测试必须能由 `seal-harness:check` 直接执行，自行在临时目录编译，不能依赖未提交的测试产物。

商店 `artifactFiles` 从资产详情的 `versions` 读取版本元数据，沿用版本导出、大小与 SHA256 校验和安全 ZIP 解包；不假设服务支持单独版本 GET。浏览器仅收到允许预览的文件，不收到 descriptor 或凭据文件。云端写入仍沿用现有 ZIP/PATCH/ETag 契约。

连接器 `summary` / `category` 为兼容旧数据的可选元数据；新建的 `save.authMode` 复用既有 OAuth 或请求头配置。`testTool` 仅接受当前 id/revision 下启用的工具及对象参数，经过原生 ToolRuntime 执行、超时与取消，不绕过 guard、审批或工作区限制。

## 会话上下文选择器

- `@seal-harness/session-context-selector` 是 Client-only 产品插件，通过 `conversation.input.left` 提供“能力”“连接器”“智能助手”三枚并排的独立入口；由 `productPlugins` 构建、装配并写入产品 Profile，不在 DSH 上游复制输入框。禁止重新合并为“资源”总入口；历史会话引用继续使用既有 `@` 链路，不混入这组三项。
- 能力入口只写入 `/skill `，随后由官方 input-trigger 和技能候选链路继续处理。写入必须使用 `inputActions.captureInsertion()` 与 `insertText()`，不得覆盖后来发生的草稿编辑。
- 已有会话的 Agent Preset 不可替换，专家入口进入专家管理并说明新会话生效。连接器入口在输入框原位打开已安装连接器选择器；`connectors/sessionList` 与 `connectors/sessionSet` 是唯一会话绑定契约，选择按账号和 session id 持久化，Host 同时通过 Agent scoped `tools.restrict()` 和执行 guard 隔离工具。连接器管理仅作为选择器底部次级入口，禁止用 Client chip 或本地数组伪造绑定。
- 回归入口：`node --test seal-harness-desktop/plugins/session-context-selector/tests/*.test.mjs seal-harness-desktop/plugins/connectors/tests/connectors.test.mjs`。测试覆盖触发文本、选择器 RPC、面板次级路由、构建后 slot 注册、卸载清理和跨会话工具隔离；`seal-harness:check` 必须包含相关目录。

## 产品契约

- 左侧产品菜单顺序固定为“项目、专家、技能、插件、连接器、知识库、智能体”。Seal Harness自有入口在各自 `sidebar.panellist` 注册处设置 `order`；上游“插件”入口通过公开 list-slot priority shadow 复用原组件并只覆盖 `order`，不得复制插件管理页面或直接修改已安装上游包。
- 产品身份由产品目录内的实际配置统一供运行时和打包读取。名称为Seal Harness，app ID 为 `com.seal-harness.desktop`，默认 Home 为 `~/.seal-harness`。尊重用户显式 `DSH_HOME`，不覆盖已有 DSH 数据或配置。
- 核对运行时名称、安装器名称、快捷方式、各平台图标、数据目录与更新渠道。未配置Seal Harness更新服务时，应通过产品插件组合禁用社区产品更新，并验证不会请求或安装 DSH Desktop 更新。
- Seal Harness保留模型设置页供用户按需配置，通过产品 `cordis.patch.yml` 将 `ui-settings-models.config.credentialOnboarding` 固定为 `false`，启动工作台时不自动弹出官方模型 API Key 引导。
- Seal Harness通过产品 `cordis.patch.yml` 统一覆盖 `system-prompt`：关闭上游 Harness 固定身份，以“Seal Harness开发者平台中的 AI 助手”为默认 Persona，并保留 runtime 上下文与工作目录；账号 Profile 不重复写入产品默认提示词。
- 图标保留原始资产、来源和 SHA256。沿用有效的 Git LFS 跟踪；不把 LFS pointer 当作图片使用。许可证与上游 attribution 保留。
- 复用现有编译、原生依赖、Electron 打包及 afterPack 检查。不要把开发用 Electron 目录作为未经验证的打包捷径。安装包存在不等于运行时检查通过。
- Windows/macOS/Linux 均需各自的原生模块、签名和安装验证。Windows 特有环境处理先核对当前上游实现，不能沿用旧补丁的结论。

## Quality Check

1. 核对当前脚本与产品配置，检查改动范围和 `git diff --check`。
2. 对产品行为运行最小有意义的自动检查，再运行受影响包的类型、测试或编译命令。修改共享 Desktop 时执行变体检查并验证两个包。
3. 对上游升级检查公开扩展接口和 bundle/profile 兼容性，再验证启动、对话、退出和插件加载。
4. 对图标运行已配置的资源检查；有 LFS 资源时执行 `git lfs fsck`。确认只读子模块无意外修改。
5. 打包保留现有最终成品检查，真实平台安装、启动、退出和升级另记结果。图形、签名、发布等未执行项必须明确标注。

上游 Host 集成测试使用对应包的普通 `build` 产物，产品验证使用 `seal-harness:build` 产物。不要把读取上游源码配置的测试与带Seal Harness编译常量的 Host 混用：HMR 会按编译身份重新组合 profile。完成上游测试后重新执行 `seal-harness:build`，再进行产品启动验收。

可恢复错误给出原因和可执行下一步。配置无效、资源缺失、接口漂移或产物身份错误应终止相应准备/打包步骤，不静默降级成社区产品。

## 登录与离线工作台契约

1. **范围**：Seal Harness启动登录与身份功能；不将远端身份校验加入全部 DSH 本地请求。
2. **接口**：`POST /api/seal-harness-identity/status` 与 `availability` 使用标准 RPC 信封、空 payload；Client 服务 `sealHarnessAuthClient.openLogin()` 打开账号页。
3. **数据**：`status` 返回本地身份/服务信息及 SSO、企微状态，不联网。`availability` 返回 `{ server: 'reachable' | 'unreachable' | 'notConfigured', sso, wecom }`；探测已配置身份根下的 `api/v1/auth/me`，不带凭据，不跟随重定向，5 秒超时。
4. **错误**：启动恢复失败不阻止 Host 初始化，网络失败、超时、HTTP 服务错误分别提示并保留保存记录供重试，失效凭据清除并重新登录。任何 HTTP 响应表示可达；网络错误/超时允许主动跳过，身份服务未配置时明确提供本地工作台入口。Host RPC 故障显示错误，不能当作离线跳过。
5. **场景**：启动自动通过 refresh 恢复已保存身份，成功直接进入工作台；启动登录页每 5 秒探测，服务可达后自动重试暂时失败的保存登录。过时探测不得覆盖新身份或外部登录事务；恢复请求不得并发。跳过、退出或主动开始新登录后停止自动恢复。无有效记录时在线启动登录；离线主动跳过后保留本地工作台与“未登录”入口。网络恢复不抢占当前页面。项目、商店独立要求身份，本地技能/连接器/专家正常使用。
6. **验证**：身份测试覆盖 HTTP 401/404/503、超时、无配置、非默认企微地址和 status 零远端请求；Client 测试覆盖在线禁止跳过、离线进入、重连不阻断、重新登录、身份入口及商店清理旧账号状态。
7. **禁止/正确**：禁止全局 HTTP 门禁调用远端 `getAccessToken()` 或登录后整页重载；在云端业务请求边界校验身份，Client 通过账号订阅更新。DSH 原有连接认证保留。
8. **账号 Home 与离线跳过**：Seal Harness启用账号 Home 时，未认证状态只能从中性 `login/` Home 进入离线工作台；若当前仍在账号 Home，主动跳过必须先切回中性 Home 并完成原生重启，旧账号会话和 Profile 不得随离线跳过开放。
9. **本地文件系统**：Seal Harness账号是业务身份，不是操作系统用户。产品本地存储使用系统默认创建权限，不添加 POSIX 权限位、属主或 ACL 检查，不强制 `0700/0600`，也不把这些作为账号隔离或启动条件。账号 Home 可使用普通目录或链接目录；实际无法读写时报告文件系统错误。技能包中的文件属性用于保留脚本可执行能力，不用于账号权限判断。
10. **启动扩展边界**：账号启动模块负责 Home、Profile 状态路径、渲染器分区及目录说明文案，Desktop 只应用结果并展示通用窗口。首次向导用独立产品配置 `setupWizardEnabled` 控制，缺省启用，不以账号模块存在推导。账号选择与延后重启统一在原生 runtime，IPC 只转发，直接 Host 与隔离 Host 行为一致。

## 项目内嵌原生对话

- 项目插件通过 `conversation.content` factory 的 `embedded` 变体及固定 `chat` 视图复用 DSH 消息、输入、附件和工具展示，不维护第二套消息 UI。
- 内嵌消息区域保持 `flex: 1 0 auto` 的纵向容器；原生 `conversation.session` 在空会话时返回 null，不能依赖其内容撑高。空会话、首条消息和长消息滚动时输入框均停靠底部。
- `ProjectUIRuntime.mountConversation(host, sessionId, signal)` 返回 `prefill` / `dispose`。先经项目会话 API 校验归属，再刷新目录并 `sessions.retain`；`SessionProvider` 绑定精确引用，取消/卸载释放一次，旧请求不能清空新视图。桥接层和已提交的 React 视图共同持有引用；通知移除 portal 只是排队更新，须等两方都归还后才最终释放，避免尚未退出的 Provider 读取已释放引用。首次提交前取消和 ready 迟到失败同样必须释放。
- React portal 使用项目宿主的 light DOM，通过原生 HTML slot 投射到 Vue Shadow DOM，沿用 DSH CSS 和 React 上下文。构建 external 同时覆盖 `react` 与 `react-dom`。
- 拆解文本经会话作用域 `slash/input-insert-text` 追加，保留原生引用与附件；收起只隐藏。所选会话键使用既有账号隔离存储，恢复仍校验项目归属。
- 页头成功切换到不同工作空间时，右侧自动创建并打开该空间的新对话；首次绑定只创建一次，取消选择或重选同一空间不重建会话。以成功绑定的 `localProjectId` 比较，忽略选择过程中的临时空快照；新空间创建失败后重试仍创建新会话，不能恢复旧空间的选择。快速切换时取消旧挂载，迟到响应不得覆盖当前视图或所选会话记录。历史会话保留并显示其实际 cwd，不能把当前项目偏好标成旧会话执行目录。
- 项目助理使用项目内容区右侧面板，默认 440px，调宽上限仅为项目内容区边缘，支持指针/键盘调宽、展开与收起；内容区不超过 980px 时转右侧抽屉。布局变化不得重建原生会话；概览与助理由页头并排入口切换同一个右侧面板，首次默认助理；原配置内容复用 ProjectConfigAside，侧栏内部不重复切换入口。选择、收起状态和拖动宽度由客户端插件内存 Map 按项目保留，页面卸载不清空，账号释放时清空；不写入本地存储。上次成功打开的项目同样保存在插件内存，重新进入项目功能优先恢复；通知指定目标优先，加入入口回列表，恢复目标被拒绝访问时清除记忆并回列表。
- 项目页面首次打开后由公开 `shell.overlay` 插槽保留唯一 React portal，`main` 插槽只接回同一 DOM；切出时 DOM 脱离文档并设为 inert，Vue/Pinia、会话引用、草稿及业务事件订阅继续存活，不因导航重拉数据。整个项目页隐藏时卸载原生对话 React 子树，回来重新绑定；DSH 同一会话的 Lexical 编辑器只有一个 DOM root，不能让隐藏项目输入框与主聊天窗同时挂载。面板收起、展开和调宽仍只调整布局。账号释放、插件卸载或关闭程序时销毁；挂载失败提供重新加载入口。详情页收到 degraded 重同步或连接恢复时补拉当前页，复用既有 reconnect 与按页加载。所有冷启动入口先在 `mountProjects` 完成身份与事件初始化，禁止依赖经过列表页。
- 回归入口：`node --test seal-harness-desktop/plugins/projects/tests/ui/*.test.mjs`；生命周期回归使用真实 React 与 Lexical，覆盖同会话项目/主窗往返、提交前引用可读、取消、迟到失败和 StrictMode。普通 textarea fixture 不能证明原生编辑器绑定正确。真实登录后的输入、清空、导航与布局切换另做桌面验收；涉及发送/回复行为时再验证实际消息链路。

## 知识库、智能体与统一服务配置

1. **范围**：知识库和智能体是 `plugins/knowledge`、`plugins/agents` 的独立标准 Host/Client 插件，随 `productPlugins` 构建和装配；不修改 DSH 会话内核或上游 UI。
2. **接口**：`POST /api/seal-harness-knowledge/<action>`、`POST /api/seal-harness-agents/<action>` 采用标准 Connection RPC 信封；知识文件下载为同一 Connection 上的 `GET /api/seal-harness-knowledge/file?groupId=...&fileId=...`，直接转发 Response 流。Host 的 `sealHarnessSkills`、`sealHarnessConnectors` 用 `call('workflowResources'|'workflowExport', payload, signal)`；`sealHarnessKnowledge` 同名方法直接调用。携带部署凭据的导出接口不注册 Client RPC。
3. **配置与数据**：复用基础 Home 的 `services.yml` 和唯一文件选择变量 `SEAL_HARNESS_SERVICES_CONFIG`。`knowledgeBaseUrl`、`knowledgeTargetType`、`terminalBaseUrl`、`workflowRuntimePackDirectory` 不另建模块环境变量。额外知识服务保存为 `knowledgeServices: [{id,name,baseUrl,targetType}]` 和 `activeKnowledgeServiceId`；`sealHarnessServices.getKnowledgeConfiguration/saveKnowledgeService/activateKnowledgeService/deleteKnowledgeService/subscribe` 负责持久化与切换。`getConfig()` 返回当前有效服务。独立知识服务用 `POST v1/clients` 登记，凭据按地址保存在 DSH credentials；平台模式复用身份 token。能力商店网络入口为 `STORE_PROD_BASE_URL`；Stratex 的 `CAPABILITY_STORAGE_PROD_BASE_URL` 只作缓存身份，不能当请求地址。
4. **错误边界**：Host 激活不依赖远端可达。多服务切换取消整个分页、资源列表、文件导出操作，不能只取消切换瞬间的单次 HTTP。真实协议、网络和文件错误返回失败，不自动换服务；下载不改成 base64 中转。独立流程部署缺少 Docker 或远端不可达时保留原因，不伪报已启动。
5. **场景**：知识库新增服务保留 YAML 注释及其他配置，切换即时生效；本机自主智能体创建/恢复时通过 `workspaceRegistry.create` 与 `attachSession` 绑定目录，通过 `sessions.flush` 确保空会话也能恢复；SSH/智枢流程使用来源协议。临时索引资料集可以创建、上传、查询并清理。坏例是界面显示“运行中”但会话没有绑定目录，或把另一个服务的迟到数据展示为当前资料。产品 Profile 以 `@seal-harness/agents/registry` 替代默认 Agent 服务：继承公开类、保留 `super.create/resume` 的原句柄及调用方归属，关闭时取消并等待在途初始化，再调用原始 disposer。旧代清理按对象身份匹配；只释放本机实例目录中的记录，不把取消一轮工作等同于注销，也不关闭普通对话。
6. **验证**：模块测试检查真实 Cordis 注册/卸载、远端协议、原生 Client 交互；最终运行 `seal-harness:build` 与 `seal-harness:check`，实际桌面确认页面和会话行为。API 夹具通过不等于真实 Docker/SSH、平台部署、模型回复或跨平台安装通过，各自记录。
7. **正确装配**：部署脚本与固定发布清单由 agents 的 `resources/` 复制到 `lib/resources/`；`ssh2` 为实际运行依赖且使用根锁文件。模型目录使用已安装 pi-ai 的公开 `providers/all` 导出。替换默认 Agent 服务使用 `agent.disabled: true` 加 `insert` 新条目；patch 的 `name` 是匹配校验，不能用同 ID 改名来替换插件。Host 扩展方法为 `agents.releaseInstance(id): Promise<void>`，释放失败向调用方传播。不得拷贝另一个 Agent 内核、Windows 自主运行器或来源产品的权限审核与兜底体系。
8. **原生会话恢复**：Host 删除后，同 ID 恢复不会自动清除旧 Client Session 的 `removed`。实例页打开时，只退役已 removed 的公开 `sessions.binding(id).ctx`，再 retain/ready/open/release；有效引用不重建。回归必须使用实际 session-controller Client 验证删除、恢复和旧引用仍存活的情形，不能只 stub `openSession`。
