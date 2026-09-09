# DeepSeek Harness 插件兼容

最新复核见 [重新对齐审计](dsh-realignment-audit.md)。本页包含历史实施记录，
不代表所有功能已完成端到端验收；尤其供应商目录不等于 OAuth 登录已对齐。

Seal Harness 通过可选包 `@seal-harness/dsh-compat` 运行基于
`@deepseek-ai/cordis` 的 DSH 插件。兼容层使用真实 Cordis 4.0.1，而不是重新实现一个
只有表面相似的 `ctx` 对象。

当前产品边界以 [Seal 产品与执行边界](seal-runtime-boundary.md) 为准：默认使用 Seal 页面，Pi 是唯一执行内核。下列历史 UI 对齐记录描述复用能力，不代表默认启用 DSH 整套界面；DSH Loop fallback 和 DSH SDK 子进程适配器已移除。

## 安装和加载

```sh
seal-harness plugin --profile web add 'github:user/repo#path:/plugin'
seal-harness plugin --profile web list
seal-harness plugin --profile web doctor
```

插件按需安装到独立 Profile。Web Host 即使没有安装第三方插件，也会默认组合兼容运行时、
官方 `standard` / `ptc` / `minimal` / `cordis` Agent Preset 及其基础服务；若自定义 Profile
已经提供 `dshCompatServiceToken`，则保留该部署作为权威实现，不重复挂载。默认应用包不包含
第三方插件、主题素材或其依赖。源码开发时仍可在原生 ESM Profile 中直接导入模块：

Web Host 会把当前 Profile 已声明提供的全部桥接服务提升为兼容运行时的启动依赖，确保
Model、Session、Agent、Tool、Context 等 Seal 权威先就绪；不会因 Cordis 可选注入的启动竞态
误建第二套 DSH Agent/Session 事实源。

```js
import * as myDshPlugin from "my-dsh-plugin";
import { dshCompatPlugin } from "@seal-harness/dsh-compat";
import { defineProfile } from "@seal-harness/host";
import { plugin } from "@seal-harness/kernel";

export default defineProfile([
  // model/session/context/policy/tools/runtime/agent 插件……
  plugin(dshCompatPlugin, {
    plugins: [{ plugin: myDshPlugin, config: {} }],
    defaultToolRisk: "external",
    toolRisks: { known_read_tool: "read" },
  }),
]);
```

```sh
seal-harness --config ./seal-harness.config.mjs "Use the DSH plugin"
```

## 已兼容

| DSH/Cordis 能力 | 行为 |
|---|---|
| 函数、类、`{ apply }`、module namespace | 交给 Cordis 原生 Registry 加载 |
| `inject` | 服务出现后激活；服务消失时卸载；再次出现时重新激活 |
| Standard Schema `Config` | Cordis 在插件执行前验证并应用转换结果 |
| Service、Event、Fiber、Effect | 使用真实 Cordis 生命周期和作用域 |
| `ctx.tools.register()` | 转换为 Seal ToolDefinition 并自动随 Fiber 注销 |
| DSH `defineTool()` 结果 | 使用其 JSON Schema、execute、output.render 与 finalizeContent |
| `deferContext()` / `concludeTurn()` | 追加用户上下文按序进入下一步；上下文与 steering 排空后结束当前轮 |
| 工具安全 | 统一经过 Seal JSON Schema、Policy、Approval 和结果大小限制 |
| DSH `webServer` | 精确同源 API 路由注册与生命周期清理 |
| Host/Client `connection.rpc` | Host 插件注册自定义 channel，或在共享 `/api` 上按 endpoint matcher 拦截；浏览器使用标准 `client-request/server-response` envelope、`rpcId` 关联、目标校验与取消信号调用；Seal 核心路径不可被劫持 |
| Typert registry / loader / gateway | 默认提供官方 Typert schema、package reflection、lookup/context/provider registry；使用 `configFile` 时自动发现各 Loader entry 的 `./typert` Host artifact 并随 entry 生命周期注册/撤销。Seal Host 未提供 `typertGateway` 时安装官方本地 Remote dispatcher；Web Host 已提供共享 carrier 时保持其 gateway 权威。三层均可分别关闭 |
| Host directory picker | Web Host 存在时按官方 `directory-picker-auto` 规则在启动时选择稳定 backend：仅环回绑定、非 SSH 且宿主显示可用时选择 native，其余选择 browse；也可用 `directoryPicker.backend: "browse" | "native"` 固定实现、配置 `maxEntries` 或关闭，已有部署级 `directoryPicker` 时保持其实现权威 |
| Launch environment | 默认发布官方不可变 `launchEnvironment` 快照，按 process → project `.env` → user `.env` 的固定信任顺序解析变量并保留来源路径；可传入已解析的 project/user 层、关闭，或通过 `services.launchEnvironment` 保留外部启动器的权威快照 |
| Host workspace registry | Web Host 把原生持久 WorkspaceRegistry 作为 DSH `workspaceRegistry` 的唯一事实源；第三方插件可同步 list/get，并执行 create、resolveByPath、rename、delete、workspace/session 排序、显式 attach/detach、archive 与目录状态检查。兼容运行时在该 registry 存在时自动挂载官方 WorkspaceController；桥接在每次持久提交后发布官方 `domain/changed` record/global 事件，因此 `remote.workspace` 的命令、业务错误、baseline 及 upsert/remove/order/archived follow 增量都直接走第一方实现。桥接保留稳定 entity identity，不创建第二份 DSH workspace 数据 |
| Web Client Bundle | `window.__ModuleLoader__`、Effect 和同源脚本加载 |
| Client `locale` | 注入兼容的双语词典、绑定翻译、订阅和语言切换服务；消息角色/推理/上下文、运行状态、附件接纳、工作区与 Session 动作、模型发现、设置保存和插件管理等动态创建的控件同样从当前词典取值，不在中文界面回退为英文硬编码。语言热切换会原位更新已挂载的声明式控件、消息时钟及复制按钮，并在复制成功窗口内保留正确的“已复制”状态 |
| Client `modules` | 生成 DSH `BootManifest`/`window.__DSH_BOOT__`，首次通过内容 revision 锚定的共享 batch 注册全部 factory，HMR 后切换单包 URL；按 `dsh.client.external` 动态到达边与 `inject` 包依赖拓扑物化；提供平台 seed 分流、`/client` 规范化、require 边记录、循环检测、import/prefetch，以及向反向依赖级联并接受新 revision 的 HMR invalidate |
| Client `loader` | 提供 Dynamic Cordis Client Runner 所需的 create/resolve/remove facade；从 `__ModuleLoader__` 已注册 factory 创建动态 entry，保留插件 inject 的 pending 表、可等待 Fiber 激活和级联 effect/slot 清理，并允许同一动态插件卸载后以新版本重新注册 |
| Dynamic Cordis Client Runner | Host capability 启用时直接加载官方浏览器 bundle；在真实 Cordis Client 根上下文中运行其 Timer、Inspect 同步、审批 orchestration、closure guard、Host invoke 和 `dyn/*` 双半插件 Fiber，未启用 Host Runner 时不下载或启动 |
| Client 发布产物 | Seal 构建阶段把 Cordis、Client Runner、UI Cordis、UI primitives、React 与其样式打包为浏览器可直接加载的同源 ESM/CSS，不依赖 Node 裸模块解析；工作区固定复用 ReactDOM 18.2、`@types/react` 18.3.1 与 `@types/react-dom` 18.3.0 的单一 ABI，避免官方 UI 的可选 peer 自动解析出第二份 ReactDOM 或 React 19 类型；Service Worker 同步缓存并按 shell 版本淘汰旧产物 |
| Official shell ABI gate | Web 包固定安装官方 `dsh-api-gateway`、`dsh-api-session-controller`、`dsh-client-ui-renderer`、`layout`、`sidebar`、`slots` 与 `client-store` 的 `0.1.2-rc.1` 精确版本；集成测试通过官方 `/client` factory 协议在真实 Cordis 上校验 Session list/control 投影、root/sidebar 注册、locale face、session scope adapter 与 `uiWorkspace.startSession` 调用。生产浏览器也会在隔离的真实 Cordis root 中激活同一组合，复用唯一 React/ReactDOM ABI，并暴露显式诊断 mount face。 |
| Client `uiWorkspace` | 默认 Seal 页面继续使用兼容导航桥；隔离官方壳改由官方 Workspace Controller 消费 `remote.workspace.follow` baseline/increment，并由官方 UI Workspace 实现显式 Workspace、当前 Workspace、最近 Workspace、blank Session 复用、归档及目录选择策略，不再维护第二套预览投影。 |
| Official Conversation shell | 生产组合激活官方 `ui-session`、`ui-conversation`、`ui-chat`、品牌、附件、Tool、产出、轨迹、Approval、User Questions，以及 Input Trigger/Commands/Skill/Reference/Subagent `0.1.2-rc.1`；Session Controller 消费 Host control baseline/delta、历史 page/follow journal、projection、queue 与生命周期事件，Workspace Controller 消费工作区流。两参数全局 Remote waterfall 监听会解析到官方 Session scope。官方组合现为默认页面；仅 `#seal-shell` 显式保留旧 Seal 壳，且官方启动未 ready 时不会隐藏旧 root。 |
| Official Settings preview | 隔离官方壳由发布版 `ui-settings` 提供唯一 `settingsScope`/`settingsSchema` 和 describe mirror，不再复制 Seal 简化 scope；同时激活 General、Models、Plugins 与只读 Plugin Inventory 页面，写入、凭据、模型发现和插件清单继续使用已对齐的官方 Remote namespace。 |
| Official feature surfaces | 官方壳继续激活 Model Selection、Permission Presets、Plan、Goal、Jobs、Message Feedback、Schedule、Agent Preset、Workflow Run，以及 browser Directory Picker；各插件直接读取官方 Session Controller projections、Commands/UI service 与已对齐 Remote namespace，能力缺席时遵循上游空表面/禁用语义。目录流遵循上游 auto composition 的单占位约束，不同时激活 native/browse。动态 Cordis Runner 与 UI Cordis 按当前页面只在一个 root 激活：默认进入官方 root，`#seal-shell` 回退时进入旧 root，不跨 root 复制持有 Slots 的 service。 |
| Official Chromium smoke | `pnpm --filter @seal-harness/web smoke:official -- <authenticated-url>` 使用 Node 标准库通过本机 Chromium CDP 加载真实服务，要求 client/shell ready、默认挂载、旧 root 隐藏、核心 Controller/UI 插件激活、官方 DOM 非空且无 console/runtime exception；`SEAL_BROWSER_PATH` 可覆盖浏览器路径。 |
| Official startup ownership | 默认官方壳不会再同时启动隐藏的 Seal 旧应用，因此旧壳的 onboarding、settings、轮询与全局对话框不会覆盖官方页面；`#seal-shell` 仍完整启动旧应用。Session Controller 提供的 Agent setup 独占 Preset scope 组合，兼容层只在直接调用者没有 setup 时补默认组合，避免已有 Workspace 自动建 Session 时重复绑定同一 scope parent。 |
| UI Theme | 每次 Web 启动均运行官方 `dsh-client-ui-theme` Client 插件（不依赖默认关闭的 Dynamic Cordis Runner），安装其 base、design-platform、corner-shape、scrollbar、gradient 与 Shiki 全局样式并提供 `theme` service；DOM presenter 同步 color scheme、dark attribute、字号与动态 token。`ui-theme` preference/fontSize 通过 Seal revisioned settings scope 持久化；General 设置页声明并渲染官方 `settings.general.item`，直接使用第一方 Appearance/Font Size 控件，第三方 Skin 仍由独立选择器切换 |
| Conversation busy Enter | 注册与 DSH 相同的 `ui-conversation.busyEnter` live settings（默认 `queue`）；繁忙时普通 Enter 按偏好排队或插话，Cmd/Ctrl+Enter 执行相反行为，Shift+Enter 保留换行，IME 合成与按键重复不会误提交；主会话运行中且草稿/附件为空时，主操作切换为 Stop，输入待发送内容后恢复 Send 并显示独立停止入口 |
| Chat transcript view | 注册与 DSH 相同的 `ui-chat.transcriptView` live settings（默认 `compact`）；历史消息携带所属 Turn 与完成状态，Compact 只把已完成 Turn 中最终答案之前的 Assistant/Tool 过程折入 disclosure，用户输入和最终答案保持独立，Normal 恢复完整平铺；分页追加和设置热更新都会重新投影 |
| Responsive app frame | Web 壳层采用与 DSH 相同的三栏让步链：侧栏默认 280px、拖拽范围 264–420px、折叠轨 56px、低于 1024px 自动折叠且可手动临时展开；中心列优先保留 640px，右侧 Session Details 在 300–520px 内先收缩、空间仍不足时自动关闭。宽度与宽屏折叠偏好持久化，拖拽期间停用轨道动画 |
| Conversation content width | Active 会话提供左右对称拖拽柄，并沿用 DSH 的 `dsh.conversation.contentWidth` 偏好键、640px 下限、176px 边缘预算与无偏好时 `clamp(680px, 64%, 920px)` 自适应策略；Transcript、审批区和 Composer 共享同一宽度轴，中心列收缩时仅临时钳制显示宽度，不覆盖持久偏好 |
| Composer context meter | 最近一次 provider usage 的 input/cache traffic 作为准确占用样本，当前模型目录提供精确 context window；两者齐备时 Composer 显示与 DSH 相同的百分比环，点击展开近似 token 数与容量，支持外部点击/Escape 关闭。无法从 Seal 日志证明 system/tool 构成时不伪造 breakdown |
| Goal dock | 当前 Session 的 active/paused/blocked Goal 持续显示在 Composer 上方，完整目标通过 title 可读；支持 revision-CAS 的暂停、恢复、行内编辑与清除，操作期间禁用控件、失败恢复并展示 Host 错误，完成或不存在时隐藏 |
| Todo dock | 当前 Session 的非空 Todo 投影显示在输入区，默认折叠并按 completed/in_progress/pending 汇总非零计数；展开后逐项显示状态图标与正文，切换 Session 恢复折叠，空清单隐藏，动态刷新保持当前展开状态并尊重 reduced-motion |
| Per-Session Composer draft | Composer 使用 DSH 的 `dsh.conversation.<sessionId>` 持久键保存草稿；切换 Session 或刷新页面会恢复各自草稿，成功提交后清空，写入时保留同一 Conversation store 中的其他视图字段；新建页草稿也独立保存 |
| Session hierarchy header | 会话摘要同时接受 Seal `sealHarness.parentSessionId` 与官方 DSH Header 的 `parentSession/origin`，统一投影为 `origin/parentSessionId`；DSH 的父级与来源保持独立，普通 fork 不会仅因存在 `parentSession` 就被伪装成 subagent。会话头部据此推导根到当前节点的面包屑，父级可点击返回，当前节点禁用，subagent 节点带层级标识，并对缺失父级与循环元数据安全降级 |
| Turn navigator | 服务端从完整 Session surface 生成零基 Turn outline 与有界 prompt/response 预览；会话右侧导航轨标记全部已知 Turn、区分尚未加载的历史、跟随滚动高亮当前 Turn，并在点击旧 Turn 时先分页加载再平滑跳转；少于两个 Turn 时隐藏，支持键盘标签、忙碌状态和 reduced-motion |
| Max-token turn notice | Pi runtime 将每个 Turn 的 provider stop reason 持久化到 `turn.completed.stopReason`；`length` 精确映射为 DSH `turn/end.reason=max-tokens`，刷新和分页后仍在最终 Assistant 与 Turn tail 之间显示“回复可能不完整”提示；旧日志安全省略 |
| Pending interaction takeover | Approval 与 Ask User 请求携带 Session 归属；Web 只选择当前 Session 最早的待处理项接管 Composer 座位，其他 Session 的请求不会误阻塞当前输入。审批使用 `Reject` / `Allow once`，Plan Review 使用 `Keep planning` / `Approve`；提交期间禁用动作，失败恢复，750ms 轮询不会重建同一表单或清空用户已填写答案 |
| Permission UI safety | Session 权限选择器沿用 Seal 的持久权限投影与切换 API；选择 DSH 约定的 `danger-full-access` 时必须经过独立风险说明、显式勾选确认和取消/遮罩退出，未确认不会触发 Host 写入 |
| Reasoning presentation | `reasoning_delta` 不再只显示状态后丢弃正文；实时推理进入展开的独立 Markdown disclosure，运行完成后自动折叠，持久历史中的 `reasoning` block 也以相同结构回放，并与最终答案和 Tool 卡片分离 |
| UI Cordis | 每次 Web 启动均加载官方 UI Cordis 与 UI primitives；只有模型生成代码所需的 Dynamic Cordis Client Runner 继续受 Host capability 控制。兼容 slots 的延迟注入/生成器清理、侧栏 footer action、Tool keyed view 和 `@pluginId` input source。Seal composer 会查询并通过 source `onPick` 插入官方 input-trigger 候选，保留引用 source/value/clipboardText；`@path` 与开放的 `@"path with spaces` 使用官方边界语义，目录 drill 状态持续到菜单关闭；支持 Up/Down、Enter、目录 Tab drill、Escape 与同步的 `aria-selected`/`aria-activedescendant`。Cordis 面板挂载到独立的真实侧栏 footer slot，实时与持久化回放的 `tool_call` / `tool_result` 都会原位渲染并更新官方 Cordis 卡片，跨历史分页边界也可反向配对；Session 切换时显式卸载卡片 React root。其他消息布局仍遵循 Seal UI |
| Client `remote.commands` | 命令发现与执行优先使用目标 Session 的官方 Agent 与 CommandRuntime，保留 Agent Preset 的局部命令覆盖、图片接纳、取消和官方生命周期；cold Session 临时恢复后必定释放。官方运行时缺席时回退 Seal CommandService，并使用 DSH `RemoteResult` |
| Client `remote.settings` | 优先直接桥接官方 Settings Controller 的描述、更新、替换、路径变更、revision 冲突和原生打开能力，使官方 LLM 配置目录的 settingsNs 与读写事实源一致；控制器缺席时回退 Seal 设置服务；可打开已物化的设置文档或用户 Agent Preset 目录，无桌面环境时返回目录路径供展示 |
| Client `remote.agentPresets` | 优先暴露官方 roster、authorable 能力、composition 原文读取、整目录复制、用户 preset 删除及 Session 选择；未配置官方 roster 时回退为 Seal Profile-owned 只读清单，并保留 locked/not-found/read-only 错误 |
| Client `remote.goals` | create/edit/pause/resume/complete/clear 优先通过 Agent lookup/resume 调用官方 GoalService，保留运行态 armed/disarmed、轮次预算、revision CAS、生命周期校验与 clear 后 one-past tombstone；官方服务缺席时回退 Seal Goal API |
| Client `remote.messageFeedback` | 优先直接调用兼容运行时中已挂载的官方 MessageFeedback/DSH bridge，原样保留 list/put/delete 的业务 Result、幂等删除、opaque version CAS 及 session/target/note/version 失败；服务缺席时才从 Seal 持久反馈 sidecar 转换 positive/negative rating 与 epoch 时间。Assistant 消息操作区将第一方赞/踩 glyph 置于复制与分支之间，并提供可选 note 的新增、编辑、清空与取消；备注编辑器按上游在触发器下方保留 4px 间距，并复用统计详情的视口夹取、外部点击和 Escape 关闭协议，同步焦点与 `aria-expanded`。赞、踩和备注保存共享同一 mutation gate；评分开始时结束旧编辑会话，任何请求在途时其余入口均被锁定，避免并发 CAS 写入和草稿丢失。评分失败以 `alert` 就地显示在按钮旁，备注保存失败显示在编辑器内并保留草稿供修正，同时仍写入页面级诊断状态 |
| Client `remote.subagents` | 优先直接调用官方 SubagentRuntime 的 catalog、prompt 与 interruptByParent Remote 方法，保留附件准入、时区规范化、parent-live/ownership 校验及精确错误；官方服务缺席时才将 Seal durable direct-child 目录映射为 DSH continuable catalog |
| Client `remote.sessionReferenceResolver` | 按官方 Agent lookup 解析或恢复目标 Session，优先调用 Agent Preset 私有或 Host `sessionReferenceResolver`；官方服务缺席时从同一 SessionStore 提供最多 50 条候选，排除自身，按相同工作区、无 cwd、其他工作区稳定排序，可按 id/cwd/title 搜索，并生成 lossless canonical mention |
| Client `remote.fileReferences` | 按官方 Agent lookup 语义解析或恢复目标 Session，优先调用 Agent Preset 私有的 `fileReferences` provider、其次调用 Host provider；官方服务缺席时复用 `WorkspaceFileSearch` 在 Session cwd 内提供可取消候选，并沿用 20 条结果、50000 条索引预算和默认排除规则，不读取或泄露文件内容 |
| Client `remote.workspace` | 六个 unary 操作及 follow 流优先委托已挂载的官方 WorkspaceController，保留其串行化、领域错误、返回值和 `domain/changed` 增量；控制器缺席时将原生 WorkspaceRegistry 投影为官方 workspaceId/view 形状，并由 Host stream carrier 生成可取消的 baseline + upsert/remove/order/archived 增量，Client 不再自行 HTTP 轮询 |
| Client `remote.llm` | 提供 listProviders、listConfigurableProviders 与 discoverModels 官方契约；活动 provider 优先读取 DSH 官方 adapter 目录（保留无模型 route 与显示名），无官方运行时时才由当前 Seal 模型目录投影；可配置 provider 直接读取 DSH 官方配置目录（未挂载官方目录时为空，Seal 数组式设置不伪装成 DSH 对象路径）；已注册 provider 可无网络发现，草稿 baseURL 可携带一次性 apiKey 查询 OpenAI-compatible `/models`，并转换 contextWindow/maxTokens 与结构化拒绝详情，不持久化凭据 |
| Client `remote.credentials` | 优先直接桥接官方 Credentials Controller，统一批量上限、引用语法、元数据投影与拒绝分类；控制器缺席时回退 Seal CredentialService。describe 只返回 configured/source/writable，set/unset 中密钥只单向写入，拒绝时仅回传 ref 而不回显值 |
| Host `authorization` | 共享 Credentials 权威存在时默认挂载官方交互式授权 seam；插件可按 credential record 注册 OAuth、设备码或账户选择 flow，调用方获得 notice、text/secret/select prompt、取消、同 key 单飞与提交确认语义。已有部署级 `authorization` 时保持其实现权威，也可显式关闭 |
| Client `remote.skills` | 按目标 Session 的 cwd 与 Agent Preset scope 读取官方 DSH Skill Registry；live Agent 优先使用 preset 私有 skills 服务，cold Session 使用 standing preset key 而不激活 Agent。过滤不可由用户调用的条目，只投影 name/description/whenToUse/modelInvocable，且不为目录展示加载技能正文 |
| Client `remote.directoryPicker` | 直接桥接当前官方 directoryPicker capability；browse 后端支持可取消单层列举与单段目录创建，native 后端支持 pick，能力不匹配时返回 directory-picker/unavailable 而不模拟结果 |
| Client `remote.pluginInventory` | Loader 存在时直接使用官方 `dsh-host-plugin-inventory` 快照，只投影非 group Cordis entry、有效启用状态及实时 Fiber 阶段；启用 Agent Presets 时同时返回每个 preset 的官方组合行。官方服务缺席时才从 Seal manager/Loader 构造兼容回退 |
| Web Plugin runtime inventory | Plugins 设置页读取 `remote.pluginInventory` 的全局条目与 Agent Preset 组合；默认选择默认 Preset，支持切换 Preset、折叠分组、展开模块/entry/config/runtime/condition 事实、跳转其他 Preset 命中，并按模块名或 entry ID 搜索；失败条目优先并突出显示，Preset 提供关系可追溯，安装清单与运行时清单独立处理失败且可重试 |
| Web installed plugin localization | 已安装插件的空态、数量、包状态、缺失适配器、契约就绪说明、安装/刷新/启停动作全部随当前 DSH locale 重渲染，不再在中文界面残留固定英文 |
| General settings documents | General Settings 读取官方 settings describe、Agent Preset roster 与目录能力；新会话选择器、Session 状态卡、管理弹窗与插件清单共享同一 DSH roster 和显示解析，过滤损坏选项，官方内置 Preset 名称与描述随 locale 切换，用户 Preset 保留文件中自定义文案；选择器 roster 刷新失败时保留上一份成功快照、报告诊断但不中断主应用 bootstrap。存在设置文档时提供原生打开入口，Preset 按内置/自定义分组并标记默认或损坏状态；可在只读弹窗查看 composition，自定义 Preset 在 Host 支持时可打开所在目录；三个读取并发执行，roster 失败才阻断管理面，settings describe 或目录 opener 失败只禁用对应控件并保留其余 Preset 操作；两类错误均原位显示诊断与本地化重试入口 |
| Agent Preset authoring | Host 标记 authorable 时任意健康 Preset 可复制为用户 Preset；损坏 Preset 与无可写根时保留禁用的复制入口并解释原因，损坏内置 Preset 不提供无法成功的 composition 查看，用户 Preset 则直接引导到目录修复。副本 ID 按官方路径安全规则校验必填、格式与全 roster 冲突，可选显示名为空时省略；用户 Preset 提供受控删除确认。非默认且未损坏的 Preset 可写入官方 `agent-presets.default` 设置，成功后同步刷新管理 roster、新会话选择器与插件清单；只读 settings provider 保留禁用入口并解释原因。复制/删除期间冻结对话框，Host 拒绝原位恢复并显示诊断，成功后同步重读三处表面；复制完成直接打开新 Preset 目录，Host 无桌面 opener 时在对应行揭示路径；内置 Preset 不提供删除入口 |
| Agent Preset Creator mode | roster 含 `cordis` 时，自定义 Preset 分组即使为空也保留“用创造模式创作”入口；Host 无可写根或当前 Session 正在运行时原位禁用并解释原因。触发时先暂存 `cordis` 选择，再进入空白新会话、关闭设置并聚焦 Composer，首次提交沿用正常 Session 创建契约 |
| Agent Preset selection | 无 Session 的新会话界面暂存选择并在首次提交时创建；已存在的空白 Session 则立即通过官方 Agent Preset selection API 持久切换，请求在途和 run 期间锁定控件，Host 拒绝时回滚到已提交值并显示本地化诊断；已开始 Session 的组合固定不可切换。普通“新会话”恢复部署默认 Preset，Creator mode 则保留显式 `cordis` 暂存。官方 roster 在组合存在时注册为 Seal 运行入口的预设权威，同名内置项、`ptc`/`cordis` 与用户自定义项均由官方目录实时校验；每次首次运行在收集 Context 前恢复官方 Agent scope 并挂载选定组合，损坏或未知项仍 fail closed，避免“界面可选但旧目录拒绝”或仅记录选择而未实际组合 |
| Models settings localization | Models 页的 provider/model/reasoning/API key、自定义 provider 表单、目录统计、容量和能力标签、发现结果全部使用当前 DSH locale；切换语言会基于现有模型快照即时重绘统计与详情，不触发网络请求 |
| Credential onboarding | Web 首次启动会检查当前 DeepSeek route 的凭据 configured/source/writable 状态；缺少可写凭据时显示阻塞式、可选择稍后的本地化配置框，保存通过共享 CredentialService 原子落盘。Models 页同步显示缺失、本机文件或启动环境来源，只允许清除可写的已存凭据；环境继承的只读凭据不会被重复提示或覆盖 |
| SDK JSON-RPC transport | TypeScript/Python SDK 与 stdio server 使用标准 `jsonrpc: "2.0"` request/response/notification framing，server 返回带 code/message 的结构化错误；客户端仍接受旧版 string error，server 仍接受未带版本的 Seal 请求，但显式错误版本会被拒绝 |
| Configuration localization | Configuration 页的刷新、空态、namespace 计数、只读标识、即时 revision/重启生效、secret 状态及本地 JSON/数字校验使用当前 locale；语言切换原位更新已渲染 schema 表单标签，不重建 DOM 或丢失未保存草稿 |
| Client `remote.session` | Web DSH 组合在九项必需服务齐备后自动挂载官方 SessionController；list/modelCatalog、create/selectModel/rename/fork/prompt/cancel/updateQueue、attachment、page/follow/control 与路径打开均直接保留官方 projection、cold-read、Agent 激活、连续流和错误语义。依赖不完整的自定义组合仍提供 Seal 投影回退 |
| Client `remote.session.prompt` | 空闲时后台启动，活跃时 queue/steer；校验 request/timezone，将 `user-rpc` request id/时区持久关联到消息，文本与图片先持久接纳再返回 |
| Client `remote.session.search` | 优先调用官方 SessionController 的授权、可取消搜索；控制器缺席时仅检索未归档且具备工作区的当前用户/助手消息，每 Session 一条、20 条上限、240 code-point snippet |
| Web Session search | 侧边栏提供可展开的 Session 历史搜索；标题、Session ID、cwd 与 Workspace 标题/路径在输入后立即本地匹配，当前临时空白 New Session 不进入结果，随后与 Host 正文命中稳定去重合并；每条结果独立显示 Workspace/Ungrouped 上下文与可选正文片段。沿用 250ms 防抖、500 UTF-16 code unit 上限、NUL 过滤和代理对边界保护，支持 Esc/清除关闭，空查询点击外部自动收起而非空查询保持展开，并保留加载/空结果/失败/更多结果状态，可从命中片段直接打开 Session |
| Session hover card | Session 行停留 500ms 后显示可达的浮层，保留完整标题、与 DSH 相同桶规则的相对更新时间及运行/空闲状态；指针跨越行与浮层间隙时使用关闭宽限，点击卡片复制完整标题并原位显示反馈，刷新、拖动与语言切换会清理旧浮层 |
| Session row metadata | Session 行主文本使用标题和 DSH 紧凑相对时间，不再把内部 Session ID 当作可见副标题；ID 保留为时间单元提示，运行中 Session 在固定状态槽显示活动标记，空白新会话不伪造更新时间。只有真实 `blank` 会话显示 New Session，普通无标题历史会话回退为 Session，行、菜单标签和悬停卡片使用同一规则 |
| Blank Session promotion | 当前选中的临时空白 New Session 首次出现在所属 Workspace/Ungrouped 与单列表账户顶部，不占折叠五行配额；用户手动移动该空白行后记录账户级覆盖，后续刷新不再重复提升。会话首次提交后失去 `blank` 身份并清空该轮提升状态 |
| Session row actions | Session 操作收进带 `menu/menuitem` 语义的省略号弹层，支持外部点击、Escape 和方向键/Home/End；触发器与弹层之间采用指针离开宽限，可跨越间隙往返而不丢失菜单。重命名、分支、归档/恢复及手动排序键盘入口保持可用 |
| Workspace row actions | Workspace 的重命名、移除和手动上下移动也复用同一省略号菜单、焦点导航、外部关闭及跨间隙宽限；菜单打开期间 portal 外的触发器保持可见 |
| Workspace hover card | Workspace 行停留 500ms 后显示完整名称、目录和本地化绝对创建时间；POSIX Home 及其后代按上游规则缩写为 `~`，Windows 路径不改写。卡片可达并复制原始完整路径，操作菜单、拖动、刷新和语言切换会撤销旧卡片 |
| Workspace row create/toggle | 点击 Workspace 名称只切换展开状态，不再意外创建会话；独立 `＋` 才把 cwd 切换到该 Workspace 并创建 New Session，且会先清除该分组的折叠状态并持久化，保证新会话出现时可见 |
| Sidebar empty state | Workspace 分组和单列表在没有任何可显示行时呈现本地化 No sessions 空状态；活动搜索的空结果继续由搜索状态区表达，不叠加普通浏览空状态 |
| Sidebar Session overflow | 每个 Workspace 与 Ungrouped 分组默认显示最多 5 个普通 Session，blank Session 不占额度；以准确隐藏数量展开其余条目，展开后可收起，且不会影响服务端顺序 |
| Sidebar Session fork action | 每个 Session 行暴露 Fork 动作，复用 `session/fork` 的最近已完成 turn 边界；成功后刷新列表并在当前 UI 空闲时打开副本，失败保留原 Session 并展示服务端的结构化错误信息 |
| Message-level actions | User/Assistant 消息操作区提供复制；普通消息及 Markdown 代码块使用第一方 16px copy/check glyph，复制写入期间与成功后的 1 秒反馈窗口会阻止重复触发，并以当前语言同步 title 与可访问名称；消息重绘、Session 切换或失败乐观节点移除会显式释放动作控制器、取消计时器并使迟到的剪贴板结果失效。User 额外提供本地化复用，已完成 turn 的 Assistant 使用第一方 16px branch glyph 提供分支动作；仅该 turn 的最后一条 Assistant 消息可用，较早消息保持可聚焦且通过 `aria-describedby` 和本地化提示解释不可用原因，不使用会吞掉 hover/focus 的原生 disabled。Turn 用量与耗时入口使用第一方 database/clock glyph，同上游一起落在分支之后、Assistant 时钟之前，窄屏收为纯图标；详情使用带 glyph 的标题栏、分隔线和定义列表，用量标题优先显示 provider 报告的精确总数，而不是从可见桶猜测；缓存命中率以精确 `total-output` 为 prompt 分母，因此未单列 prompt 桶不会抬高比例，部分命中也不会舍入为 100%。核心用量、Pi provider/runtime 实时双向适配、DSH chunk/持久消息、历史导入与多步聚合均保留可选 reasoning token，显示为输出项次级说明。面板固定在视口中、保留 12px 边距并在滚动、窗口缩放或自身尺寸变化时重新定位，关闭或卸载时释放尺寸观察器，支持点击外部或 Escape 关闭并同步 `aria-expanded`；耗时详情始终显示总时长，只在可用时追加解码速度与 TTFT；没有 Assistant 消息的空 Turn 保留独立尾部。最新 User 与最新 Assistant 动作栏常显，较早消息只在支持 hover 的设备上于悬停/焦点进入时显示；无 hover 设备保持全部可见，分页插入后重新计算新旧关系。消息分页接口为可用尾部携带对应的 DSH `turn/end` wire 序号并提交给同一 fork API，生成中的 turn、User/Tool 消息和 compacted summary 不提供不稳定边界。持久消息携带源事件时间，操作区按本地日历显示与 DSH 相同的同日 `HH:mm`、同年日期或跨年日期，User 时钟位于动作之前、Assistant 位于动作之后；本地午夜会主动重算已挂载标签，无需等待 Session 刷新 |
| Turn tail metrics | 已完成 turn 的最终 Assistant 消息携带持久 usage、实际 run model 与由事件时间戳计算的运行时长；Pi runtime 在首个 text/reasoning delta 记录 epoch 并随 `turn.completed.timing` 持久化，Web Time 面板据此展示真实 TTFT 与 output token 解码速度。总时长按上游向下取整为整秒并以 `Xm SSs` 跨分钟，TTFT 在 10 秒以下保留一位、其后取整，解码速度在 10 tok/s 以下保留一位、其后取整；token 紧凑值按上游固定阈值显示 K/M（不足 100 的缩放值保留一位），精确值使用语言词典指定的三位分组符，不再受主机区域设置影响。模型边界重试会累计每个已报告的计费尝试，而不让最终尝试覆盖失败尝试；reasoning 等可选分项仅在每次尝试均报告时保留。每个计费尝试还保留实际 provider/model，动态路由或重试切换后按首次出现顺序去重展示，不再误用 `run.started` 的初始模型。原生与导入历史共用上游同级的严格归一化：负数、非安全整数、reasoning 超过 output、矛盾 total 或无法证明精确总量时整组详情隐藏。Usage 可展开查看 input/output/cache read/cache write 与 provider/model；旧日志没有 timing 时明确省略而不反推伪造 |
| Conversation bottom-follow | 打开 Session 和提交自己的新消息时定位到尾部；用户离开尾部后流式增量与后台刷新不再抢夺阅读位置，并显示“回到底部”按钮；回到底部后重新跟随后续流式增长，历史分页仍保持原锚点 |
| Sidebar tree navigation | Workspace、Session 与搜索结果均投影为命名 tree/treeitem 结构；方向键在当前可见项间移动焦点且不循环，Home/End 跳到边界，Workspace 节点的 Left/Right 收起或展开，并持续暴露 `aria-expanded`/`aria-selected` 状态 |
| Trajectory ledger | Session Details 提供 State/Trajectory 标签；Trajectory 直接列出同一持久 Session 投影出的 DSH wire journal（连续 seq、type、data、surface/source/ignorable 元数据），无冗余表头，以 turn 起点分隔并标记 tool/message/turn/agent kind；点击记录在右栏打开非阻塞 complementary JSON inspector，tool call 可按 callId 切换到已加载的对应 Result。尾部默认 200 条、可向前分页，并随当前 Session 后台刷新 |
| Session Header export | Header 对当前 Session 的官方 `/api/session.export` 先执行 HEAD 能力探测；仅 raw artifact 后端实际可导出时启用 Session log 下载，未安装 export 组合、Session 不存在或 Memory/SQLite 等不支持后端保持禁用，不生成伪造日志 |
| Workspace group collapse | 每个 Workspace 和 Ungrouped 行提供独立的展开/收起控制，折叠状态跨刷新持久化；折叠整个分组时清除该组临时的 Session overflow 展开状态，但保留点击 Workspace 名称开始新会话的既有行为 |
| Session group reorder | 手动模式下 Session 行支持同组拖放及明确的前/后落点，并保留上移/下移作为键盘可访问入口；两者共享提交路径。注册 Workspace 通过权威 `insertSessionBefore` API 持久化并刷新 DSH Workspace bridge，Ungrouped/单列表使用各自浏览器本地账户顺序；边界动作禁用，新发现的 Session 不会因旧偏好丢失 |
| Sidebar View Options | 提供按 Workspace/单列表与手动/最近更新两组持久偏好，默认与 DSH 一致为 Workspace + 最近更新；最近更新使用稳定 Session ID 打破时间并列且禁用手动移动，单列表手动模式使用独立本地排序账户 |
| Workspace drag reorder | Workspace 分组支持前/后落点拖放，并保留上移/下移键盘入口；拖放提交完整 Workspace ID 排列到权威 reorder API，Session 行拖动不会冒泡成 Workspace 拖动 |
| Client `remote.session.attachment` | 优先调用官方 SessionController，校验附件确实可从目标 Session 日志到达；控制器缺席时由 Seal 校验日志可达性、SHA-256、真实图片格式和尺寸后返回 DSH ImageAttachmentRef 与 base64 |
| Client `remote.session.page/follow` | page、follow 与 control 优先直接委托官方 SessionController，保留 cold-safe 分页、gap repair 和完整 generation baseline；控制器缺席时将持久 Seal 日志确定性投影为连续 DSH wire journal，解析真实图片元数据并保留 required/ignorable 语义 |
| Client `remote.session.control/updateQueue` | control 以完整 queues/jobs/projections baseline 开场，包含 `sessionListMetadata`、按实际运行/待生效选择折叠的 `modelSelection` 与受服务端校验约束的 `imageLimits`；推送实际 Pi inbox 与 Job 变化；队列项具备稳定消息 ID，可编辑/删除，queued 项可原子提升为 steering；取消后停放，并由下一条 DSH prompt 或普通 Web run 按序唤醒 |
| Web QueueDock | 主会话在 Composer 上方只显示当前 Session 的 queued 消息，已经提升的 steering 消息立即退出 Dock，subagent Session 的队列保持只读；尚未被服务端队列快照确认的 follow-up 以 Session 隔离的 `requestId` 显示无操作 pending 行，确认后无闪烁去重；预览折叠空白并按 Unicode 字符限制为 200 字，排队图片以 24px 缩略图显示且不混入文本预览，服务端已确认图片只经 Session 日志可达性授权的内容 URL 加载，pending echo 在持久化前使用临时附件 URL；包含非文本内容的消息禁止编辑以免丢失附件；单条消息在行内显示队列标识，多条消息使用第一方本地化计数与可访问的折叠头；纯文本消息使用单行输入原位编辑，编辑时强制展开并提供保存/取消动作，异步操作期间锁定整个 Dock；所有消息均可移除或在运行中原子提升为 steering，各操作失败使用第一方本地化提示；运行期间空草稿的 Cmd/Ctrl+Enter 会按 FIFO 将所有仍 queued 的消息提升为 steering，已领取/轮次关闭竞态静默收敛；轮询按稳定快照去重，编辑输入不会被无变化刷新打断 |
| Active schedule catalog | 当前 Session 存在活动 schedule 时，会话头部显示本地化提醒计数；展开后按“逾期优先、目标时间升序、并列稳定”列出状态、完整 prompt、单次/精确循环频率、本地绝对时间与每秒更新的相对时间。弹层使用共享视口定位、外部点击和 Escape 关闭语义；无活动提醒时入口隐藏，右侧 Session State 仍保留管理动作 |
| Message image gallery | User、Assistant 与原生 Tool result 的 image/attachment block 使用同一画廊；即使未挂载官方 Cordis Tool 卡片，`read_image` 等工具的回退视图也不会把图片静默丢弃。单图按 DeepSeek Chat 规则限制长边为 240px、宽高比裁切到 `[0.25, 4]` 且不放大原图；多图显示为 64px 方形网格。图片名、加载占位、失败重试、查看原图与灯箱均使用第一方本地化可访问文案，语言切换会保留滚动锚点并刷新既有历史；持久图片与非图片下载都只经当前 Session 日志可达性授权的内容 URL 加载，乐观发送气泡在持久化前使用临时附件 URL；点击成功缩略图打开原图灯箱，支持 Esc、遮罩与关闭按钮退出，并把焦点还给触发按钮；非图片附件仍保留下载入口 |
| Composer image intake | 页面级文件拖放采用 DSH 的文件类型门禁、嵌套 drag depth 与离开视口复位规则；拖入时显示可用或禁用遮罩，`dropEffect` 同步为 copy/none，Approval/Ask User 接管或提交接纳期间明确禁用；文件选择器限制为 PNG/JPG/WebP/GIF；剪贴板粘贴按 file item 顺序接纳图片，图片与文字并存时保留文字粘贴，只有图片时阻止默认行为。三种入口仅在容量允许时整批接收图片，并沿用每图 20 MiB、每消息 20 图、图片总计 200 MiB 的第一方约束与本地化错误提示；服务端为 base64 膨胀预留请求容量，并完整解码核验真实格式、像素数和单边尺寸后才持久化；本地附件库按 2048² 像素、8192px 长边和 4 MiB 目标生成去元数据、单帧、8-bit sRGB 的 JPEG/WebP 规范副本，已经满足全部规范的图片保持字节不变，默认最多并行执行两路原生转换；模型上下文始终读取完整规范图片，文本预览字节上限不会截断图片 |
| Composer attachment rail | 待发送图片显示为可打开原图、可删除的 64px 水平缩略图轨；组名、图片动作、滚动按钮及灯箱均使用第一方本地化可访问文案，切换语言即时重建且关闭灯箱恢复触发控件焦点；溢出边缘才显示翻页箭头，翻页保留一张卡片作上下文且至少移动 200px，纵向滚轮转换成有界水平滚动，尺寸变化重算边缘，新加入图片滚到末端而首次恢复既有草稿保持原位 |
| Session-scoped attachment drafts | 待发送附件与文本草稿一样按 Session 隔离；切换会话保存并恢复各自附件，新会话首次提交获得正式 Session ID 时原子迁移草稿归属，成功消费的附件身份从所有暂存副本移除，避免跨会话串带或重复发送 |
| Attachment submission admission | 新 run 的附件在服务端发出 `started` 接受帧时立即、且仅一次地从草稿提交；接受前失败才恢复原附件，接受后的流错误不会把已发送图片重新放回 Composer，避免运行期间删除 UI 与真实请求内容发生竞态 |
| Context message rows | 历史中的 `plugin`、`goal`、`job-completion`、`agent-message`、`session-reference` 等非用户 source 不再冒充 “You” 气泡，而按 DSH 分类为可折叠 Context 行；保留 form、插件/来源 provenance、notice summary、job id 与 relay sender。instructions/catalog/snapshot/recall 按官方字段全量校验后结构化展示，文件路径去重、catalog 限 200 行并报告余量、recall 明示保留/省略/截断，畸形结构回退完整原文；普通 `user`/`user-rpc` 输入保持原样 |
| Host WebSocket upgrade carrier | `webServer.registerUpgrade()` 支持精确路径独占注册、热卸载与原始 socket/head 透传；Upgrade 请求沿用 Host/Origin/Cookie 边界，可承载 DSH `/api/remote.mux` |
| Remote stream mux | `/api/remote.mux` 使用 DSH `open/cancel → item/end/error` 文本帧，在单一 WebSocket 上并发承载 `session/follow` 与 `session/control`；逻辑流独立取消，断开会释放所有生成器；浏览器 Remote adapter 默认使用该载体 |
| Connection generation / Remote emit | `$events` 流以 `{type: ready, clientId, host.home}` 建立 generation，并将 Seal Host 实时事件投影为 DSH `emit` 帧；Client 暴露可订阅的 `generation`/`state`、`connection/reset`、指数退避自动恢复与手动 `reconnect()`，`remote.$on()` 可消费广播事件 |
| Web connection recovery | Seal 自有 EventSource 页面在展开的 Settings 入口旁同步显示连接中、断开与恢复成功状态；断开或连接中均可点击立即重建传输，浏览器 offline/online 会暂停错误表象并在恢复网络后主动重连，成功确认短暂显示后自动隐藏。折叠侧栏按上游隐藏该文字入口，避免占用窄轨宽度 |
| Scoped Remote Event | Host 暴露 `typertGateway.registerRemoteEvents()`，可直接承接 DSH `api-remotes` 事件源；waterfall 按 Agent identity 投递并经 `$events/result` 返回 `next/result/rejected`，首个 claim、Context 释放、请求取消及 generation 断开均传播取消 |
| React Slots / Store | Client 内置同实例 React 19/ReactDOM runtime，并提供 `slots`、`uiSession` 与 `@deepseek-ai/dsh-client-store`；支持父项声明子 slot、single/keyed/list/chain 分派、root/session/session-maybe 作用域、按 Session 隔离并复用 Store、priority/order、fallback、所有权校验、locale 与 observable/keyed hooks 注入，以及随插件 Fiber/HMR 自动卸载 React 树 |
| Client Session / Workspace standard kit | 提供 `sessions`、`workspaces` 服务及 Slots 的 `useSessions`、`useSession`、`useProjection`、`useWorkspaces` 标准属性；Workspace 支持创建、重命名、删除、全局排序、Session 归档及组内持久排序 |
| Host ToolRuntime | `tools.register/get/schemas/guard/restrict` 映射 Seal ToolService；`tools.scope(sessionId)` 提供显式 Session 作用域，局部工具、限制与 guard 均落入 Seal 的 ownerSession 隔离和策略执行链 |
| Code Runtime | 默认组合官方 `@deepseek-ai/dsh-code-runtime-worker-thread`：每次运行使用独立 TypeScript Worker，支持 Host binding、取消、计算/墙钟/堆/输出上限及完整错误分类；可通过 `codeRuntime: false` 关闭或传入限额配置 |
| Storage / Domain | 默认组合官方 Storage Hub、JSON backend 与 Domain form；也可用 `storage.backend: "sqlite"` 启用单文件 SQLite 事务 backend，并配置数据库路径与 journal mode；支持命名 backend、schema/version 校验、global/table、串行原子更新、变更事件和关闭排空，JSON 与 DSH base 一致默认保存到 `$DSH_HOME/storages`，可配置路径/路由或关闭 |
| Session query authority | 没有 Seal SessionStore 的独立 Host 默认使用 DSH base 的 `SQLite :memory: + openAt: never`，保留精确读取/过滤/trace 且不加载或打开 SQLite；存在 Seal SessionStore 时仍由同一数据真相的查询桥接器提供精确查询，但 Web 全文搜索只通过显式启用的官方查询能力执行，不会绕过 `openAt: never` 扫描正文；关闭时侧栏仅保留本地标题、ID 与工作区匹配。也可显式配置官方持久/内存 FTS5 索引 |
| Session telemetry | 官方 OTLP backend 默认以本地 `DISABLED` 安全态挂载；兼容 `DSH_TELEMETRY_MODE`、`DSH_TELEMETRY_OTLP_URL` 和非空 `DSH_TELEMETRY_DISABLED`，上传模式采用 DSH base 的 endpoint、gzip、批处理及超时默认值，显式配置优先。未擅自把 Seal 的缺省策略改为会在反馈时出站的 `FEEDBACK_ONLY` |
| Attachment authority | 存在 Seal AttachmentService 时由桥接层维持同一附件真相；否则与 DSH base 一致默认挂载官方惰性本地内容寻址存储，启动只解析 `$DSH_HOME/attachments/v1`，首次保存才创建目录，也可显式配置或关闭 |
| Credential authority | 存在 Seal CredentialService 时由桥接层共享其真相；否则与 DSH base 一致默认挂载 `$DSH_HOME/.credentials.yaml` 官方 provider，继承启动环境优先于托管文档，项目/用户 `.env` 作为低优先级回退，并默认提供 Authorization flow seam。文件缺失时启动不创建文件，可显式配置或关闭 |
| Settings authority | Seal SettingsService 暴露文档路径时复用同一文件；否则与 DSH base 一致默认挂载并热加载 `$DSH_HOME/settings.yaml`。缺失文件启动时视为空配置且不创建，首次设置写入时才以私有权限原子落盘；Settings controller 始终保留可诊断的 Remote namespace，也可关闭文件 provider |
| Session persistence authority | 存在 Seal SessionStore 时默认继续使用其持久化桥接；没有 Seal SessionStore 的独立 Host 则与 DSH base 一致默认使用 `$DSH_HOME/sessions` 官方 JSONL backend，按项目/Session 分层、默认 packed chunks 与校验 Zstandard frame，并保留 raw artifact 能力。root 首次 materialize 才创建，可显式配置、替换或关闭 |
| Agent scope bridge | 提供 `agents.get/list/adopt`、单一 `setFactory`、`create/resume`、initiator 上下文与 DSH Scope 生命周期；内建 create/resume 在未发布 scope 中完成异步 setup 与同步 commit，失败不发布 Agent 或新 Session，dispose 移除 live Agent 并保留可恢复历史；seed 中的用户、助手和工具结果转换为 Seal 模型历史，其余 DSH 记录以 `dsh.imported` 保存原 type/data 并按原事件名投影，所有初始记录与 `session.created` 在内存/JSONL/SQLite 后端原子提交；`agent.ctx` ToolRuntime 自动映射到 Seal `ownerSession`；Seal run 自动发布为 DSH Agent 并同步 `running/idle`，`maxTokens` 可持久恢复，`cancel/whenIdle/runMaintenance/followup/steer/send` 控制同一个 Seal execution，维护期间的唤醒在任务收敛后按 Inbox 顺序执行；Inbox 双队列查询和 clear/append/prepend/replace/remove/splice/claim 共享原子 splice 与跨队列 ID 去重，每次变更及 claim 都持久化为原生 `agent/inbox.spliced`，空闲写入发生并发版本竞争时自动重试，run 结束前执行 durability barrier，resume/新 run 从日志恢复；空闲 Agent 按最后持久化路由重新唤醒，`inject` 内容在唤醒前独立持久化并进入模型上下文 |
| Agent default model | 存在 Seal ModelService 时默认安装官方 `agentDefaultModel`，基础路由取模型目录首项或显式配置；兼容 Agent create/resume 在没有显式 `agentOptions` 且没有历史路由时读取当前 selection，并保留 settings 服务可提供的动态 reasoning override。可通过 `agentDefaultModel: false` 关闭 |
| Default LLM adapters | 独立 Host 与 DSH base 一致默认挂载 `deepseek-official` V4 模型目录、选择 `deepseek-v4-flash`，并让 pi-ai adapter 以零路由休眠，首次模型请求才解析凭据并联网；存在 Seal ModelService 时默认保持 Seal 模型目录权威，仍可显式组合官方 DeepSeek。两个 adapter 均可分别关闭 |
| Agent presets | 配置 `agentPresets` 后组合官方 standing preset roster；每个 preset 的 `agent.cordis.yml` 仅挂载一次，Agent 在未发布的 create/resume setup 阶段通过 scope parent 加入，默认或显式 preset id 写入 Session metadata，空白 Session 的运行时切换以 `agent-preset/selected` 持久化并在恢复时优先于初始 header，子 Agent 继承父级正在运行的精确 generation；挂载失败会回滚整个 Agent 创建；支持 system/user roots 与官方 shipped/user roots 开关；与 `configFile` 同时启用时，部署配置和 preset 裸包分别使用各自解析基准 |
| Agent Session metadata | create 在发布前验证绝对 `cwd`、parent lineage、`isSeeded`、origin、delegation depth、agent preset 与 `inheritedEventCount`；这些字段持久化后在 resume 时重建为 DSH 形状的 `agent.session.header` 与继承事件计数 |
| Agent Session facade | `agent.session` 提供同步 `append/eventAt/snapshotEvents/ownEvents/isOwnSeq`、请求 header/context 折叠、surface 与派生消息；DSH `surfaceOp/sourceEventSeqs` 会换算到 Seal 的一基日志序号并持久化，resume 后保持替换结果；发布与销毁按 `session/created → agent/created → agent/disposed → session/disposed` 成对通知 |
| Host SessionStore | 默认提供官方 DSH SessionStore 的独立 `create/prepare/enter/announce/flush/fork`，并将 Seal Agent 持有的 Session 合并进 `get/list/flush/fork`；Agent scope 内的 session lifecycle、event 与 flush 均沿相同作用域分发 |
| SystemPrompt / SessionProjection | 默认安装官方 `systemPrompt` 与 `sessionProjections` 服务；DSH section、variable、动态 context 和 assemble waterfall 会进入 Seal ContextService，动态 context 作为可持久用户上下文，投影单元可直接折叠 Agent Session 的兼容日志并提供 snapshot/state/checkpoint |
| Persona / prompt policy | `systemPrompt` 配置完整暴露官方部署级 `includeHarnessIdentity/includeRuntimeContext/persona/toolOrder`；第三方 Agent preset 可继续在 Agent 子作用域加载官方 `persona` 行，按 DSH 规则遮蔽全局 `deployment:persona`，并可选择 complete prompt 或抑制 runtime context |
| LLM Runtime | Seal ModelService 的 provider/model 目录、精确容量、reasoning/maxTokens、文本/思考/tool-call/usage/finish 流映射到官方 DSH `llm` adapter registry；usage wire 只输出官方 TokenUsage 字段，Seal 的 cost/routes 扩展不会泄漏到严格上游载荷。手工调用和第一方辅助调用均经过官方 `llm/stream` waterfall |
| Pi-AI LLM | 可通过 `piAiLlm` 启用官方通用 Pi-AI adapter；支持内置 catalog 路由与自定义 OpenAI/Anthropic 等兼容端点、逐请求 credentials/settings、reasoning、图片、provider retry 和动态路由替换。默认不创建路由，避免与 Seal 已拥有的同名 provider 冲突 |
| LLM Retry | 默认安装官方 provider-owned retry executor；兼容 Agent 的 request-error 桥从 DSH LLM registry 透传实际 resolved policy，按 transient code、最大次数、provider Retry-After、指数退避与 jitter 决策，取消可打断等待，并持久追加 `llm/retry`/`llm/retry-started` 审计。可通过 `llmRetry: false` 关闭 |
| DeepSeek Session Log | 可通过 `deepseekSessionLog: { enabled: true }` 启用官方无损增量 `dsh_session_log` 请求字段；仅发送当前 Session 尚未确认的规范事件后缀，并在请求成功接受后把 watermark 写回同一日志，使重启后最多保守重发未确认尾部。默认关闭，避免未明确授权时上传完整会话日志 |
| DeepSeek 插件清单 | 使用 `configFile` 启动官方 Loader 树时，默认安装官方 package-inventory 扩展，把实际活跃、非结构性 Loader entry 的包名/版本作为 `dsh_plugin_packages` 请求字段；可通过 `deepseekPluginPackageInventory: false` 关闭 |
| Repeat-tool reminder | 默认安装官方逐 Agent 重复调用提醒；DSH 工具经 Seal 策略链执行后仍进入 `tools/post-execute` waterfall，同名且规范化参数相同的连续调用会在配置阈值注入 notice context，真人消息会清零链。支持 `thresholds/include/exclude/argumentsPreviewChars`，可通过 `repeatToolReminder: false` 关闭 |
| Agent instructions / FileSystem | 默认安装官方本地 `fs` capability 与 `agent-instructions`；首个 pre-step 按 user-global、项目根到当前目录的层级发现 `AGENTS.md`/`CLAUDE.md` 及 local overlay，受单文件和总 UTF-8 预算约束，并作为带来源的 durable workspace context 进入请求。桥接 DSH 工具完成后发布规范 `tools/result`，使成功的 `read/write/edit` 可触发嵌套指令重投影。两项分别可通过 `fileSystem: false`、`agentInstructions: false` 关闭 |
| Filesystem tools | 在官方 `fs` capability 上默认组合 DSH 原生 `read`、`write`、`edit`，附件服务存在时还动态提供 `read_image`；读窗口、单行和字节上限可配置，也可通过 `fileSystemTools: false` 关闭。Seal 的 `read_file`/`write_file` 等原生工具保持并存，不发生同名覆盖 |
| String replace editor | 默认组合官方 `str_replace_editor`，在同一 DSH filesystem 上提供目录/文件查看、仅新建、唯一字面量替换和按行插入；若 Seal 已注册同名工具则保留原生实现，也可通过 `strReplaceEditor: false` 关闭 |
| Filesystem observation policy | 默认组合官方逐 Agent 观察门禁：读取记录文件存在性与版本，edit 必须先读并使用该版本做 CAS，write 在已观察文件上使用版本替换、未观察目标只允许原子新建；外部并发修改会拒绝过期写入。可通过 `fileSystemObservationPolicy: false` 关闭 |
| E2B remote world | 显式配置 `e2b` 后，使用官方 `dsh-e2b`、`dsh-fs-e2b` 与 `dsh-subprocess-e2b` 共享同一个远程 Linux sandbox；文件、命令、Bash 与终端落在相同的远程 cwd，宿主平台不再决定 shell 方言。默认不创建外部 sandbox；支持 `apiKey/cwd/timeoutMs`、单独关闭 filesystem，以及 subprocess `pollMs` |
| Sandboxed filesystem | sandbox policy 可用时，`fs` 默认使用官方 `dsh-fs-sandbox` 而非无围栏的 local backend；read 保持可用，write/edit 每次按 Session policy 执行 read-only 拒绝、workspace+temp containment 或 danger-full-access，并让标准文件工具公开受审批的一次性升级参数。无 sandbox policy 时退回 `dsh-fs-local` |
| Subprocess / PowerShell / file search | 默认安装官方本地 subprocess seam、Windows PowerShell executor、`pwsh` 工具，以及打包 ripgrep 驱动的 `glob`/`grep`。命令超时、输出、spill、终止 grace 与搜索结果预算均可配置；存在 Seal JobService 时开放 PowerShell 后台参数，否则 schema 与执行层同时禁用。两组工具可分别关闭 |
| Bash（非 Windows） | Linux/macOS 自动选择官方 local 或 sandboxed Bash executor 并注册 `bash` 工具；逐调用 sandbox policy、一次性审批升级、timeout/output/spill、进程组终止及后台 Jobs 语义与 DSH base 一致。Windows 保持 PowerShell 路径；可通过 `bash: false` 关闭 |
| LSP stdio | 可通过 `lsp.stdio.servers` 显式配置官方 stdio language-server provider；启动时统一解析 executable，按扩展名路由，并在首次匹配查询时为每个 workspace 懒启动、复用和故障替换进程；未配置时不探测或启动本机语言服务器 |
| Persistent terminal | 默认提供官方 Agent-owner-scoped `terminals` registry；存在 subprocess、sandbox policy 与 projection 服务时安装官方 Bash/PowerShell PTY backend，保留独占 send、等待原因、有界非破坏 scrollback、前台进程组信号和 awaited cleanup。不存在同名 Seal 工具时同时发布六个官方 `terminal_*` 工具；若原生工具已占名则保留原生权威，DSH 服务仍可供插件使用。支持完整 backend/result 配置或通过 `terminal: false` 关闭 |
| Jobs bridge | Seal JobService 映射为官方 DSH `jobs` seam：官方后台 PowerShell 产生的 job id、owner、输出游标、等待、终止和状态直接落入同一个 Seal registry，因此现有 `job_list`/`job_output`/`job_wait`/`job_kill` 可原样控制，避免同名工具重复注册 |
| Jobs local fallback | Seal 没有 JobService 时默认安装官方 `dsh-jobs-local`，提供逐 owner 并发上限、生命周期清理、等待/取消、输出快照及完成通知；Seal JobService 存在时仍以共享 bridge 为唯一事实源。可通过 `localJobs: false` 关闭 |
| Todo fallback | 若 Seal 尚未注册 `todo_write`，默认组合官方 DSH 事件溯源工具与 `todos` projection，整表替换写入 durable `todo/write`，下一轮开始清空投影，并校验空项与重复项；与 DSH base 一致，默认允许多个 `in_progress` 项，也可显式设为串行校验。若已有同名 Seal 工具则保持原生实现权威，避免覆盖；支持整体关闭 |
| Plan-mode fallback | 若 Seal 尚未注册 `exit_plan_mode`，默认安装官方 logged PlanModeController、`plan` projection、`/plan` 命令与用户审阅退出工具，并使用与 DSH base composition 等价的只读规划约束；已有同名 Seal 工具时不覆盖。规划提示可替换，也可整体关闭 |
| Ask User fallback | 若 Seal 尚未注册 `ask_user_question`，默认在已桥接的 `userQuestions` seam 上安装官方模型工具，保留结构化问题、选项、多选与自定义回答；已有同名 Seal 工具时不覆盖，也可通过 `askUserTool: false` 关闭 |
| Sandbox policy / permission presets | 存在 Seal SandboxService 时默认组合官方 per-Session sandbox-policy、enforcing `pwsh-sandbox` 与 permission-presets。新 Session 固化 `permission/preset`、`sandbox/mode`、`approval/policy`，运行时切换同时影响后续命令 confinement 和审批策略；与 DSH base 一致读取 `DSH_PERMISSION_MODE`（缺省 `workspace-write + ask`，`danger-full-access` 自动配对 `never`），permission-presets 从组合后的 knobs 推导默认项，显式 config 仍优先；支持自定义 preset/default/root/mode 或分别关闭。没有 enforcing backend 时不虚假安装 preset |
| Settings file | Seal SettingsService 暴露 `documentPath` 时，默认在同一 YAML/JSON 文档上挂载官方 DSH settings-file provider，使 DSH 插件保留 schemastery defaults、secret role、revision、热更新与 namespace watch 语义，同时与 Seal 配置表面共享持久化文件；也可显式指定独立 path/dshHome，或关闭 |
| Skills | 默认组合官方分层 `SkillRegistry`、filesystem provider 与模型可见 `skill` 工具；按 Session cwd 合并项目、自定义、用户及 bundled skill roots，解析 `SKILL.md`/flat skill，支持 invocation policy、provider precedence、缓存失效与可选 watcher。pre-step 持久发布结构化 skill catalog，`/skill-name` 可显式注入，模型则通过 Seal 策略链中的 `skill` 工具按需加载完整正文。与 DSH base 一致，推广性质的 `dsh-badge` 默认关闭，仅在 `skills.badge: true` 时加载；可独立配置/关闭 registry stack、filesystem provider 或 tool |
| Tool timeout / Spill | DSH 工具执行现在进入官方 `tools/execute` wrapper，声明的 `timeoutMs` 会获得派生取消信号，并在工具协作收敛后规范化为 `TOOL_TIMEOUT`；随后结果进入官方 post-execute spill policy，超出 UTF-8 上限的纯文本完整写入私有、Session 隔离的本地文件，模型只接收预算内 head/tail、locator 与读取提示。默认 inline 上限 50000 bytes，支持 root/清理周期配置或分别关闭 timeout/spill |
| Workflow | 存在 Seal SubagentService 时默认组合官方 worker-thread WorkflowEngine 与 `workflow` 工具；模型编写的受限 JavaScript orchestration 在独立 worker 中执行，`agent/parallel/pipeline/phase/log` 经官方并发、总量、输入与同步执行上限约束，子调用通过 `seal` provider 落入现有 ownership-aware subagent bridge。运行结果、取消和错误规范化，并向父 Session 追加 `tool-workflow/run-start/agent-start/agent-end/run-end` 审计；已有同名 Seal 工具时保留原生工具权威，同时仍发布官方 WorkflowEngine 供 DSH 插件调用。可配置 provider、限额、toolName、结果上限或整体关闭 |
| Structured subagents / Ralph | Seal 子代理请求支持对象 JSON Schema，并为 child 注册 Session 隔离的 `structured_output` 工具；结果经过 ToolService schema 校验后回传 DSH provider。基于此默认组合官方 fresh-agent `ralph` 循环，在独立 worker 中逐轮创建不继承对话的 child，只传递受限结构化 handoff，直到完成、阻塞或达到轮数上限；已有同名 Seal 工具不覆盖，可配置限额或关闭 |
| Dynamic Cordis Host Runner | 显式配置 `dynamicCordis: {}` 时组合官方 Host Runner、Cordis Inspect registry 和 `cordis_inspect_*`、`cordis_define/run/stop/undefine` 模型工具；沿用官方 VM 超时、Session ownership、审批等待和 Host-half 生命周期。浏览器同时提供完整 `remote.dynamicCordisRunner` 12 方法直通官方 Typert Gateway。默认关闭，因为该能力会执行模型生成的插件代码；可设置 `vmTimeoutMs` |
| 唯一执行内核 | Seal AgentService 与 Pi AgentRuntime 是产品的执行入口。兼容层不安装 DSH Agent Loop，也不提供缺少 Seal AgentService 时的备用 Loop；DSH SDK 子进程适配器及其整套 CLI 依赖已移除。时间上下文与 Goal 续轮通过 Seal/Pi 的步骤准入和持久事件桥接，并有真实 Pi Runtime 集成测试。 |
| Goal round driver | 在存在可执行 Agent backend 时默认安装官方 same-session goal-round driver；active+armed goal 会在 Agent quiescence 后经过 Session flush 屏障，按修订号和 round identity 自动排入下一轮，普通用户队列优先，修改/暂停/完成/取消及并发竞态均使旧 reservation 失效，到达上限则结构化 blocked。可通过 `goalRoundDriver: false` 关闭 |
| Time context | 默认安装官方逐 Agent 时间上下文；每个符合刷新条件的模型 step 都持久注入采样时间、与上一条模型可见消息或 step context 的间隔，并从当前 turn 的 `user-rpc` 消息推导唯一、混合或缺失的浏览器时区。支持显式 fallback `timeZone`、`refreshIntervalMs`，或通过 `timeContext: false` 关闭 |
| Session reference | 默认安装官方跨 Session 引用解析器；候选按工作区亲和度排序并排除当前 Session，显式引用通过 `SessionQuery` 精确读取 surface，经逐引用 UTF-8 预算裁剪后作为标记为不可信、只读的 durable context 紧跟原消息进入模型。支持 `maxReferences/candidateLimit/maxReferenceBytes`，或通过 `sessionReference: false` 关闭 |
| SessionPersistence | Seal SessionStore 作为持久化真相，兼容当前 handle 式 `create/open/read/append/flush/close` 与旧式 `create/append/load/inspect/prepare/borrowSession/readFrom/list/listSnapshots`；写 handle 单写者、并发 append 串行化、header/seed/surface 序号双向转换，并保留 revision 观察；支持原始产物的后端会同时暴露 `locate/readRaw`，默认 JSONL 后端返回未经重建的确切文件文本，其余后端通过 `supportsRawArtifacts` 明确降级 |
| SessionQuery | 官方 live-preferred 查询引擎覆盖 `observe/read/list/filter/surface/title/trace`；兼容查询桥仍为插件调用提供 metadata filter、分页 cursor 与 snippet，但 Web 不把它作为默认全文入口。显式启用官方 FTS 查询后，Web 才搜索 Agent live Session 和 Seal 持久日志正文 |
| SessionTitle | 默认安装官方日志型 SessionTitleService；首条真人文本即时生成规范化 fallback，手工 rename 与异步 provider 结果均追加 latest-wins `session/title`，保留消息来源序号、UTF-8 字节上限、投影、取消及竞态保护。Seal Web 的列表、引用解析和 control baseline 也按日志顺序折叠原生 metadata 与导入的 `session/title`，因此官方 fallback/provider 标题会直接显示，后写的任一路径保持 latest-wins。无共享 DSH 标题权威时的 Web rename 回退仍执行相同的终端控制字符清理、单行空白归一、空标题拒绝和 80-byte UTF-8 安全截断。存在 Seal ModelService 时组合官方 LLM provider，并经 DSH LLM waterfall 使用显式或当前 Session 路由；默认 `first-prompt`，也可选 `all-prompts` 在每条真人提示后基于完整提示集合重算。可配置标题/LLM 预算，以 `sessionTitle.llm: false` 单独关闭模型标题，或通过 `sessionTitle: false` 整体关闭 |
| SessionStats | 默认注册官方 whole-log `sessionStats` projection；Web fallback 同样从完整规范日志折叠 turn/step 数、LLM/tool wall time、TTFT、decode time 与输出 token，并向官方 Client control baseline 发布 `sessionStats`/`tokenUsage`。Composer dock 显示与上游相同的计数、紧凑耗时、平均 TTFT、解码速度、缓存命中率和累计输入/输出，结果不受客户端分页和 compaction surface 替换影响。可通过 `sessionStats: false` 关闭官方投影 |
| Session list metadata | Seal Web 与官方投影同时把原生 `turn.started` 和导入的 `turn/start` 视为非空边界；导入的真人 `user/message` 也按其原始事件时间更新 `lastPromptAt`。列表 `updatedAt` 与上游一致，只取创建时间和最后真人提示的较新值，工具、标题或维护投影事件不会把旧会话错误顶到最前；纯 DSH 历史也不会误显示为 New Session |
| SessionTurnOutline | 默认注册官方 whole-log `turnOutline` projection；保存每个 turn 的 `turn/start` 精确分页锚点、首条真人 prompt 的单行预览，以及在 `turn/end` 提交的最终 assistant 预览；预览有固定上限且不受客户端已加载窗口影响。可通过 `sessionTurnOutline: false` 关闭 |
| Session checkpoint policy | 默认组合官方语义持久化屏障：带 Session 的模型请求在 adapter dispatch 前 flush 完整 request prefix，顶层工具在副作用前 flush 已记录 call，pre-step flush 前一步 response/result；失败时 fail-closed，不执行模型或工具。可通过 `sessionCheckpointPolicy: false` 关闭 |
| Session projection cache | 默认在官方 Storage Domain 上组合 `sessionProjectionCache`；按 Session 生命周期身份和各 projection stateVersion 保存水位化 checkpoint，creation/turn-end/dispose 强制写入，事件数/时间间隔触发 write-behind；缓存仅作冷读加速，失配或损坏会丢弃并从精确日志自愈。可配置节流或通过 `sessionProjectionCache: false` 关闭 |
| Attachments | Seal AttachmentService 映射为官方 DSH `attachments` 服务；支持批量限制、PNG/JPEG/WebP/GIF 完整解码与类型/尺寸校验，通过已同步临时文件与硬链接原子发布只读内容对象，重复发布及每次读取都会复核 SHA-256、字节数和图片引用元数据；以存储后的 MIME、字节数、规范尺寸、净化文件名和可选 `originalDimensions` 作为权威引用事实；模型路由的像素或字节预算更小时按 `request-image-v5` 身份、相同比例投影和 85/75/60 JPEG/WebP 阶梯生成请求变体，而不是拒绝图片；相同变体的并发读取共享一次转换，各调用的取消只结束自身等待，生成结果按变体摘要持久缓存并可在附件服务重建后复用，损坏缓存会忽略并重新生成；浏览器 subagent prompt 的 base64 图片也先准入并替换为持久引用 |
| Runtime invariants | 默认安装官方 `invariants` registry；支持全局启停、package allowlist/blocklist、重复注册保护、异步 installer、作用域卸载及带 packageName 的 `INVARIANT` 错误 |
| Credentials | Seal CredentialService 映射为官方 DSH `credentials` provider；`resolve/describe` 每次读取且 describe 不暴露密钥。默认本地 provider 支持可写 reference、结构化 API key/grant record、跨进程写锁、原子落盘、外部文件热加载与不含密钥值的更新通知；环境变量覆盖仍保持只读，桥接会按底层 provider 的实际能力报告 writability |
| Sandbox | Seal SandboxService 映射为官方 DSH `SandboxProvider`；逐调用转发 mode、workspace root、session identity，并保留 enforcement、denial signatures 与 runner-failure rules；具体使用 Windows ACL、Landlock、bwrap 或 seatbelt 由 Seal backend 决定 |
| User approval | 默认安装官方 DSH ApprovalService，保留 `ask/never` policy、Session override、open-turn 约束、`approval/asked`/`approval/decided` 成对审计、取消竞态与 scoped waterfall；最终人工决定映射到 Seal ApprovalService |
| User questions | 默认安装官方 DSH UserQuestionService；保留空问题、plan-review、取消、exact-live-agent 与 runtime-root 校验，Agent-scoped waterfall 映射到 Seal 的结构化多问题/多选 answer service；被其他 live Agent 拥有的 child 按官方语义拒绝直接询问用户 |
| Goals | 默认在兼容 Agent Session 上安装官方 DSH GoalService；支持 create/get/edit/pause/resume/block/complete/clear、revision 并发校验、round budget、armed/disarmed 激活状态、`goal/change` 持久事件、投影与系统提示上下文 |
| Goal tools | Seal 未注册 `get_goal/create_goal/update_goal` 时，默认安装官方 DSH 模型工具；保留 direct-human/goal-round authority、revision CAS、blocked 连续轮次门槛及 complete/blocked 收尾上下文。已有同名 Seal 工具时保持原生实现权威，可通过 `goalTools: false` 关闭 |
| TokenMeter / Compaction | 默认安装官方 replay-aware TokenMeter，并在 Seal ModelService 已映射为 DSH LLM 时组合官方 BasicCompactionEngine；支持 usage anchor、surface/token pressure 投影、自动 pressure/context-overflow 触发、保留窗口、LLM 摘要、事务事件与手工 maintenance compact。可通过 `compaction: false` 关闭 |
| Tool-result pruning | 默认安装官方 replay-safe ToolResultPruner；BasicCompaction 在调用 LLM 摘要前先按 Unicode code point 对超长工具结果保留头尾、持久追加 shadow-price 与 surface replacement，富内容块顺序不变。阈值和头尾预算可配置，也可通过 `toolResultPruner: false` 关闭 |
| Commands | 默认安装官方 DSH CommandRuntime 及 `/feedback`、`/goal`，具备 LLM compaction 时同时安装 `/compact`；支持全局与 Agent-scoped 命令层、局部覆盖、稳定发现顺序、图片附件准入、取消，以及 `command/run`/`command/done` 成对持久审计。可通过 `commands: false` 关闭 |
| Message feedback | 存在 Seal MessageFeedbackService 时优先桥接为带 Typert Remote 标记的 DSH `messageFeedback`，共享同一持久化真相并转换 rating、时间戳、版本冲突和业务错误；没有原生服务时，可由部署级兼容实例通过 `messageFeedback: {}` 安装官方 sidecar。两种路径都只接受最终 assistant 消息，且不进入模型上下文 |
| Session log export | 可由部署级兼容实例通过 `sessionLogExport: {}` 安装官方 `/export` 命令与 `/api/session.export` 下载路由；仅在 commands、connection、sessionQuery、sessionPersistence 与 attachments 全部存在时发布，并要求持久化后端支持 raw artifact（默认 JSONL 支持，Memory/SQLite 返回 501）。Web 按官方行为始终请求目标 Session 的完整后代树及引用图片，并使用 `dsh-session-<safe-id>.zip` 文件名。该能力不是逐第三方插件默认项，避免多个兼容实例争用全局路由 |
| Subagents | Seal SubagentService 存在时映射为 DSH `subagents`，使用 fresh `seal` 与 completed-turn `seal-fork` provider；独立 Host 则与 DSH base 一致默认挂载官方 in-process `spawn`/`fork`，并让 Subagent、Workflow、Ralph 共享实际存在的 fresh provider。支持调用方预留 child ID、continuable 创建、双向父子消息、浏览器 prompt/catalog/interrupt、父子所有权校验、直接子项与完整后代树枚举。默认组合官方 `subagent` 与 `subagent_fork`：主 `subagent` 默认创建 continuable 后台 child并立即返回 durable id，显式 `run_in_background: false` 才等待；fork 只复制父 Session 最后一个 completed run 以内的 surface，排除活跃尾部，保留模型路由并采用 one-shot。可分别关闭；Seal 已有的 `list_agents`、`send_message`、`interrupt_agent` 不重复注册 |
| Agent Teams | 已从上游私有实验源码对齐隐式 Lead、不可复用的具名 teammate、fresh/fork 创建、持久 roster、queued/delivered peer mailbox、冷恢复重投、Lead 权限、变更等待，以及 revision CAS 的共享任务 DAG。默认 Profile 使用上游同名九工具替换旧 subagent 目录，并注入共享 checkout 协作策略；任务支持依赖 readiness、owner、claim/release/complete/reopen/reassign/delete、write-scope 重叠提示。官方壳会话头部提供 Team roster 与任务面板，Web API 共享同一服务真相。与上游实验实现相同，成员共享 cwd，write scope 不是文件锁，也不提供跨进程共识。 |
| Agent request waterfall | 在真实 provider 调用边界按 Agent scope 分发 `agent/request`；监听器替换的 provider/model、reasoning effort 与 maxTokens 会作用于当前调用，并成为后续 step 的默认请求配置 |
| Agent pre-step waterfall | 每个真实模型 step 打开请求前按 Agent scope 分发 `agent/pre-step`；`enter` 可替换本 step 已 claim 的用户消息，并同步更新运行上下文及持久 Session surface；`reject` 不调用 provider、不生成空助手消息，并从模型历史移除被拒绝输入 |
| Agent request-error waterfall | provider 请求失败后、终止结果提交前分发 `agent/request-error`；返回 `{ kind: "retry" }` 会在相同 turn/step 中重新执行 `agent/request` 与 provider 调用，未声明重试则保留错误结束 |
| Agent turn-stopping | turn 即将结束且当前 steering 为空时串行等待 `agent/turn-stopping`；监听器可调用 `agent.steer()`，运行时随后重新读取真实 Pi 队列并继续下一 step |
| Agent live notifications | 按 Agent scope 发布 `agent/inbox/inserted`、`agent/inbox/claimed`、`agent/inbox/discarded` 与 `agent/error`；Seal Web/运行时发起的队列变更同样进入通知链，而不只覆盖 Cordis 侧调用 |
| PTC `run_code` | `toolPresentation: "ptc"` 可设置部署默认值，`"both"` 同时保留原生工具；Agent Preset 也可直接组合官方 `@deepseek-ai/dsh-agent-tool-presentation`，其 `native/ptc/both` 声明沿 standing preset → Agent Scope 链继承并在同进程内按 Session 隔离；系统提示使用官方 `renderToolsSdk()` 从当前 Session Schema 生成 TypeScript binding 声明；Worker 内 `tools.*` 可并发回调可见工具，仍经过参数校验、策略/审批、取消与结果整形，非文本内容附回外层结果；每个已启动子调用以提交顺序 ID 持久化原生 `tool/code-dispatch-start`/`tool/code-dispatch` 事件，失败与中止同样成对收口 |
| GitHub `#path:` | partial clone + 运行时文件白名单 |

兼容层默认把 DSH 工具分类为 `external`，因此默认需要审批。只有明确了解工具行为后，
才应通过 `toolRisks` 把单个工具调整为 `read` 或 `workspace-write`。

## 可注入服务

插件声明了兼容层没有内置桥接的 `inject` 时，可以显式提供受信任适配器：

```js
plugin(dshCompatPlugin, {
  services: {
    metrics: myMetricsAdapter,
  },
  plugins: [{ plugin: metricsConsumer }],
});
```

已有的 Cordis 配置树可以直接交给官方 Loader：

```js
plugin(dshCompatPlugin, { configFile: "./cordis.yml" })
```

该入口支持 `cordis:include`、`cordis:group`、嵌套条目、`inject` 等待、`disabled` 与
`!!js` 配置表达式；相对路径以启动工作目录为基准。也可以同时配置 `plugins`。
需要开发期热替换时可显式启用官方 HMR：

```js
plugin(dshCompatPlugin, {
  configFile: "./cordis.yml",
  hmr: { roots: ["src", "cordis.yml"] },
})
```

`tools` 名称在 Seal `ToolService` 存在时由兼容层保留，不能被配置覆盖。

### Plan 模式输入反馈

Plan 状态除右侧 Session state 管理卡片外，也会在输入框工具行显示状态胶囊。胶囊只在
Host 投影的有效目标为 Plan 模式时出现（包括待进入、排除待退出），点击可关闭 Plan
模式；运行锁定期间不可操作。有效 Plan 状态还会切换输入框占位提示，退出后恢复默认
提示。该行为与 DSH `conversation.input.plan` 控件的显隐、锁定和失败反馈语义一致。

### 本轮产出文件

Web 会从成功完成的写入类工具结果中读取结构化 `details.path`，去重后附加到该轮最终
Assistant 回复下方。文件胶囊保持首次产出顺序，点击会把对应 `@path` 放入输入框，便于
下一轮继续引用；失败的工具结果、读取工具以及非最终 Assistant 消息不会产生该区域。

### 后台任务入口

当前会话存在后台任务时，Web 会在会话标题栏显示紧凑任务入口：优先显示运行中/停止中的
数量，没有活动任务时显示保留任务总数。展开列表按活动任务启动时间升序、已结束任务结束
时间降序排列，展示类型、名称、状态/详情和耗时；仅在展开且存在活动任务时每秒更新时间，
并支持 Escape 与点击外部关闭。右侧状态卡仍保留取消活动任务的操作。

### Web 搜索与抓取卡片

`web_search` 与 `web_fetch` 的实时结果现在把 `ToolResult.details` 作为 DSH ToolView 的
`meta` 传入，历史回放也会从匹配的持久化 `tool.completed` 事件恢复同一份结构化元数据。
原生 Web 工具输出与 DSH 卡片契约保持一致：搜索提供 `answer`、`sources`、`truncated`，
抓取提供 `url`、`statusCode`、`truncated`。因此已打包的 DSH WebRow 可以显示标题、摘要、
来源链接、发布日期、HTTP 状态和截断提示，而不是退回纯文本结果。

### Steering 消息语义

Web 消息投影会回放 `agent/inbox.spliced` 的 `next-step` 队列状态，并只把非取消移除所
claim 的同 ID 用户消息标记为 `steering`。编辑、删除、排队到下一轮以及普通回合起始输入
不会被误判；前端通过 `data-message-kind="steering"` 保留该语义，同时沿用 DSH 中普通用户
消息与已接纳 Steering 消息共用的右对齐气泡外观。

紧随普通用户或已接纳 Steering 消息之后的 `session-reference` recall Context 会把全部有效
引用标签关联回前一条消息，并在气泡下显示与 DSH 一致的“Referenced session / 引用会话”
摘要；非邻接、字段不完整或跟在非直接用户节点后的 Context 不会产生错误关联。

### 命令生命周期行

Web 会把 `command.run` 与同 ID 的 `command.done` 折叠为一个位于原始运行序号的命令行，
并与消息按日志顺序共同分页。未结束命令显示运行中，结束后区分成功与失败；单行结果直接
作为摘要，多行结果可展开查看完整正文。孤立的完成事件不会生成伪造命令节点。

### Turn Error 行

失败的 `run.completed` 会关联到同一 run 最近的真实 `turn.started`，并在日志位置生成独立、
可访问的错误行。导入的 `turn/end.reason.kind: "error"` 同样保留 provider message 与稳定 code；
`AUTH` 原始诊断不会进入 UI 状态，界面显示本地化认证失败文案，避免历史日志中的凭据片段
泄漏。主动中止、正常结束以及尚未进入 turn 的启动失败不会被误标为 DSH Turn Error。

### Max Tokens 行

原生 `turn.completed.stopReason: "length"` 与导入的 `turn/end.reason.kind: "max-tokens"`
都会在回合结束位置生成独立的最大输出长度警告，即使该回合没有可附着的最终 Assistant
消息也不会丢失。普通完成、中止和错误结束不会生成该节点。

### Compaction 行

Seal 原生 `context.compacted` 不再伪装成普通 Assistant 消息，而是在检查点位置显示独立的
上下文压缩行；可展开查看 Markdown 摘要，并显示能够由日志精确证明的折叠项数。导入的
DSH 自动压缩会关联 `compaction/summary` 与紧随其后的 `plugin: compact` replacement
checkpoint，保留其折叠项数和 token 数；证据不完整时不会编造统计。带
`sourceCommandId` 的手工 `/compact` 会进一步把 command run/done、摘要和 checkpoint
合并为一个定位在 checkpoint 的节点，避免重复显示命令行与伪用户消息。

### 模型 Retry 行

兼容层原样保存的 `llm/retry` 与 `llm/retry-started` 会按 `retryId` 折叠成单个模型重试行，
保留当前次数、最大次数/无限模式、延迟、provider 与失败码/原因。等待状态按浏览器首次渲染
时钟显示倒计时，开始、取消和后续重试会更新原节点；字段不完整的导入记录不会进入会话流。

### System Prompt 行

Seal 原生模型调用会在 provider dispatch 前持久写入规范 `request.header`，记录实际生效的
provider、model、reasoning effort、max tokens、system prompt 与工具定义；DSH 历史导出将其
无损映射为 `request/header`。Web 同时投影原生与导入事件：首个 header、续接/新 series，
以及新 series 或 system 内容变化的 change 会显示可折叠 System Prompt；仅工具变化的
同 series change 与空 system prompt 不生成会话节点。正文区域采用有界滚动，避免长提示词
挤占整个 transcript。每个 turn 的首个请求提示按 DSH 位置规则锚定到 `turn/start`；导入
日志还会把后续 step 的首个提示锚定到对应 `step/start`，同一步中的再次变更仍留在真实
header 序号，从而保持稳定顺序且不会把系统提示错误排到用户消息之后。

### Unknown Surface 行

由已注册 DSH 插件定义、但当前 Web 没有专用 renderer 的 append/replace surface 事件会保留
原始 `surfaceOp` 与来源序号并参与同一 replay；Web 使用可折叠、有 50000 字符展示上限的
JSON 节点诊断其 type/data，而不是静默丢失。Opaque 插件数据不会被错误送入 Seal 模型
消息历史，未声明为 surface 的普通扩展事件仍保持 log-only。

### Workflow Run 行

Web 会把 Seal 原生 `workflow.*` 与导入的 DSH `tool-workflow/*` 生命周期分别按 workflow/run
ID 折叠为定位在 start 事件的单个节点，显示运行中、完成、失败、取消或中断状态；若所属
turn 已闭合而 run-end 缺失，则 run 与仍在运行的成员按上游语义投影为中断。Agent 按原始
phase 分组，保留“未提供 phase”和空字符串 phase 的区别；成员状态随 end 事件更新，并可
直接打开对应 child session。孤立 update/end 不会生成伪造的 Workflow Run 节点。

### Turn Process 折叠

紧凑 transcript 会把最终回答之前的同 turn 过程折叠为一个 disclosure。摘要统计来自持久化
Assistant tool-call block，而不是渲染出的 call/result DOM 数量，因此通用工具不会重复计数、
Cordis Tool 卡片不会漏计；`subagent` 与 `subagent_*` 调用按 DSH 规则从普通工具中分离统计，
中间 Assistant 回复只按真实 reply 节点计数。没有可计数活动时显示“思考了一会儿”。
运行中的 turn 也会建立默认展开的 disclosure；turn 结束但没有最终回答时，已有工具或中间
消息仍折叠为过程，独立 Turn Tail 保持在 disclosure 外。

### Turn Tail 与分支边界

已完成 turn 的用量、耗时、TTFT、解码速度、模型和产物信息不依赖 fork 是否可用，都会保留
在 closing Assistant 的尾部。只有 closing Assistant 同时也是该 turn 最后的 Assistant/Tool
transcript 节点，且 turn 不是 error 结束时才发布精确 `atSeq` 分支边界；其后仍有 Tool result
或 Turn Error 时禁用分支，与 DSH 的 `branchUnavailable` 语义一致。
若已完成 turn 根本没有 Assistant，Web 会在 `turn.completed` 或导入的 `turn/end` 位置生成
独立 Turn Tail，仍显示能够从日志证明的用量、时序、模型与产物；Max Tokens 与同位置 footer
会合并渲染，警告和指标都不会丢失。DSH seed 导入时，用户、Assistant 与 Tool result 会保留
稳定的 `dsh-turn-N` 归属，原事件时间、Assistant usage 与模型 source 也会持久化；因此导入历史
同样能把完成状态、精确耗时、聚合 token 用量、模型、turn 序号和分支边界关联到 closing
Assistant。重新导出时会重建导入的 turn/step 状态，并恢复原生 `assistant/message` 及其 usage、
source、`interrupted` 标记，而不会退化成 Seal 私有兜底事件。中断后持久化的 Assistant
前缀会在消息气泡下显示“已停止”，与 DSH 的冻结部分回复语义一致。
导入的 Tool result 也会从同一步 `tool/call` 恢复工具名称，并保留其内部 `error` 身份、私有
`meta` 和 message source；Web Tool 卡片接收原始 meta/error，再导出时恢复相同字段且不会
重复合成已有的 `step/end`。
标准 DSH `{ type: "image", attachment }` 内容块会转换成带原始引用元数据的 Seal attachment，
用户与 Assistant 图片均不再降级成占位文本；即使当前附件存储不可查询，重新导出仍能逐字段
恢复 attachmentId、媒体类型、尺寸、字节数和名称。
Assistant tool-call 同时保留可执行的解析参数与模型产生的原始 `arguments` 字符串；DSH Tool
卡片、会话再导出以及 DSH LLM 到 Seal ModelService 的实时请求桥都使用原始字符串，因此空白、
字段顺序及无法解析的 provider 原文不会被 `{}` 替换或被重新序列化。实时请求桥还会按 call id
从历史 Assistant 调用恢复 Tool result 的真实工具名，而不是退化为通用 `tool` 名称。
Seal ModelService 返回的工具调用若携带 `dshArguments`，反向 DSH 流的 delta 和最终 block 也会
逐字使用该原文，仅在没有原始参数时才序列化可执行对象。
反向流在 reasoning、text 与 tool-call 类型切换时先闭合当前 block，再开启下一个递增索引，
不会产生多个重叠的开放 block；usage 到达时也会先闭合活动 block，保持第一方适配器规定的
`block-end → usage → finish` 顺序，而不会在 finish 前补发乱序的旧 block-end。
DSH LLM 经 Seal ModelService 执行时，User、Assistant 和 Tool result 中的标准图片引用都会从当前
DSH AttachmentStore 读取原始字节并转换为 Seal 原生 image block；因此 Assistant 图片不会被丢弃，
仅由 DSH 本地附件库持有的图片也不会以 Seal 无法解析的裸引用进入模型。
DSH `GenerateOptions.stop` 会逐项透传至 Seal `ModelRequest.stop`，通用 ModelService 实现可直接支持；
内置 Pi provider 与 DSH 第一方 Pi adapter 一致，在无法支持时以 `UNSUPPORTED_OPTION` 明确拒绝，
不会静默忽略停止序列并生成越界内容。
Seal 模型目录的 description 会进入 DSH 模型发现与精确解析结果；可选的 `supportsImages` 未声明时，
DSH `inputModalities` 同样保持缺省的“未知”语义，只有明确 true/false 才分别发布 text+image/text，
不会把未知能力伪装成明确不支持图片。
模型终态的 replay envelope 会双向跨越 Seal ModelService：响应级 provider 私有字段进入 Assistant
providerData，逐 block 元数据按原索引进入 reasoning/tool-call providerData；Seal 返回的 response/blocks
也会原样附在 DSH `finish.replayState`，保留响应 ID、原生停止原因及 thinking/tool 签名以供后续重放。
该 envelope 只在 stop、tool-calls 或 max-tokens 成功终态发布；error/aborted 与 DSH 第一方适配器
一致只保留 usage 和失败原因，即使第三方 ModelService 错误附带 replayState，桥层也会剥离。
历史 replay envelope 的 blocks 若存在，数量必须与原 Assistant content 完全一致；长度不符或形状
错误时 response 与全部 block 元数据一起丢弃，绝不部分套用并造成签名错位。
Seal AssistantMessage 也把 replayState 作为一等字段持久承载，Runtime-Pi 在 Core/Pi 转换和模型流
组装时双向保留；response 即使是字符串、数组或 null 也不会因 providerData 只能是对象而丢失。
DSH seed 导入会从 Assistant model source 提取并校验 replayState；Web session history 再导出时把
一等字段写回同一 source 位置，因此导入、持久化、运行时转换和历史导出形成完整闭环。
Seal SessionStore 注入 DSH Agent/Session 观察面的另一条事件桥也使用相同原生词汇：tool_call 转成
`tool-call`，Tool 消息包装成 user-role `tool-result` block，并恢复 Assistant source/replay 与工具
error/meta；不再直接暴露 Seal 私有消息形状。Seal runtime 会持久记录每次 `pre_step` 开始及其在
下一 step/turn 边界的闭合，兼容桥据此输出完整 `turn/start`、`step/start`、`tool/call`、
`tool/result`、`step/end`、`turn/end` 序列，并为 Assistant/Tool 事件恢复稳定的 turn/step 归属。
Pi 在 Assistant 完成时提供的 usage 会同时进入该条持久消息，因而实时插件和历史重放都无需等到
turn 汇总后猜测 token 统计；length、aborted、error 与 crash-interrupted 终态分别映射为 DSH
`max-tokens`、`aborted`、`error` 与 `interrupted` reason。旧日志缺少 `turn.completed` 时，也只在
检测到仍开放的 turn 后才由 failed/aborted `run.completed` 补闭合，避免新日志重复生成终态。
模型流的 text/reasoning delta 会按实际类型切换持久化为带 block index 的 `assistant/chunk`：包括
`block-start`、delta、`block-end`、usage 与 finish；工具调用同样记录 start/delta/end，并沿用模型
原始 arguments。最终 Assistant 的 `sourceEventSeqs` 精确引用本次 step 的全部 chunk，因此 DSH
插件可实时观察标准 chunk，持久化后也能进行 token 级回放，而不是只能看到组装后的最终消息。
Seal fork 在复制带 provenance 的 Assistant 时会递归复制其引用的 chunk，并按新日志位置重映射
全部来源序号；因此包含流式历史的分支不会因缺失引用而创建失败，也不会悄然丢掉 replay 证据。
每次生效的 request header 还会同步记录 DSH `request/context` 的 provider/model；模型目录无法在该
同步边界证明容量时保持 `contextWindow` 缺省。基于显式 seed 创建或从持久 Seal Session 恢复兼容
Agent 时，会在构造 seed 尾部耐久写入 `session/end-seed`；若上一次生命周期已有后续事件则写入新
marker，若日志本身已以 marker 结束则不重复增长，与 DSH 的 last-marker 生命周期语义一致。

Web Host 与 DSH WebServer 一致，对浏览器声明接受 gzip 且响应体不少于 1024 bytes 的静态资源和
动态 Client plugin bundle 使用 level 1 gzip，并返回 `Vary: accept-encoding`；SSE、NDJSON 等流式
响应保持不压缩，避免缓冲破坏实时增量交付。
会话消息窗口同样采用 DSH Client 的分页预算：首次打开及普通向前翻页默认取 50 个逻辑消息节点，
定位 Turn 时使用 200 条显式批量请求；后台刷新不把新窗口扩成 200，并保留用户已主动展开的范围。
页面边界按 surface replacement 后的逻辑节点计算。

## 明确不兼容

聊天视图的产出文件现在直接调用 Host 打开，并在失败时按 DSH 语义显示可关闭、可重试的错误对话框；
对话框保留原路径用于重试，关闭会使旧请求的迟到结果失效。独立的 `@` 操作仍可把路径插入输入框。
添加工作区对话框也已接通同一目录选择能力：native 后端直接调用系统选择器，browse 后端自动回退到
应用内目录浏览，支持主目录折叠面包屑、隐藏目录开关、截断提示、新建文件夹与确认当前目录。
浏览器采用父级/所选子级双栏推进，并可切换到完整路径编辑，Enter 导航失败时保留草稿和当前视图。
路径编辑会在 250ms 静默窗口后让目录栏跟随目录部分，末段则即时前缀筛选最后一栏；显式点前缀
可显示匹配的隐藏目录，无匹配前缀不会把列表清空。
每次目录扫描会主动中止被新意图取代的 Host 请求；旧双栏保持显示，只有扫描超过 300ms 才浮现
“加载中”提示，快速本地目录切换不会闪烁空白或加载状态。
Web Host 会安全提供 `app.js` 引用的全部单层 kebab-case 客户端模块，服务端测试逐项请求这些 import，
避免静态白名单遗漏导致浏览器只显示缓存壳层而主应用完全不初始化。允许集合从启动时实际存在的
public 根文件生成，符合命名规则但不存在的模块仍返回 404，而不是把文件读取失败提升为 500。
Service Worker 对带临时 `?token=` 的根导航完全旁路，让浏览器直接完成 Host 的 303/HttpOnly Cookie
交换，同时避免把含启动密钥的请求 URL 写入 Cache Storage；普通页面与静态资源继续采用 network-first 离线回退。
新建文件夹使用选择器内的嵌套对话框，保留输入草稿和 Host 业务错误，成功后选中新目录。
路径与文件夹名称输入共享输入法合成保护，候选确认 Enter 不会误提交；退出路径编辑会撤销
尚未落地的预览扫描并恢复稳定视图。编辑中点击目录行不会先抢走输入焦点，提交后再结束编辑；
当前选中的隐藏目录在隐藏开关关闭或前缀过滤期间仍保留可见，避免选择状态成为不可操作的幽灵目标。
直接输入路径或跳转面包屑时会尝试读取目标的真实父级，并以父级条目选中、目标目录位于右栏的
标准 Miller 落点呈现；父级读取超过 200ms 时先提交可用的单栏目标，迟到的父级仍可原位升级为
双栏。父级不可读、列表截断未包含目标或已到 Home 显示根时保持单栏，不伪造无法锚定的选择。
路径草稿预览与正式导航使用独立提交语义：预览必须等目标和父级两段都成功才一次性换栏，失败时
保留旧视图且不制造错误提示；正式 Enter 会撤销已排队的预览定时器并暂停后续预览，避免旧请求
反向覆盖已提交路径。提交失败后保留原草稿与错误，只有下一次真实编辑才重新启用静默预览。
预览扫描尚未结束时继续键入会立即中止当前 Host 请求，而不是等下一次防抖计时结束才淘汰旧结果。
草稿末段只过滤确实回答其目录部分的栏位；等待预览时不会拿末段误筛当前无关目录。Host 将 `..`、
Windows 正斜杠或路径大小写规范化后，浏览器保留请求目录与实际落点的对应关系，仍可在正确栏位
继续应用末段前缀，而不会为了同一规范化目录重复扫描。
新建文件夹请求使用浏览器打开代次与子对话框创建代次双重隔离：请求期间关闭、取消或关闭后重开，
旧请求的迟到成功和失败都不会改写新视图、启动目录扫描或注入错误。创建事务自身带重入锁，重复
Enter/提交只产生一个 Host 写入；当前对话框内的真实失败仍解除锁并保留名称草稿供修正。
深层目录导致面包屑横向溢出时，每次落点更新都会把滚动位置保持在链尾，确保当前目录和相邻的
路径编辑入口可见，而不是在跳转后退回只显示根部。
路径提交仅用去除首尾空白后的结果判断是否为空，非空时把用户输入原文交给 Host，不擅自改写合法的
首尾空格目录名。路径草稿未提交或目录扫描仍在进行时，Open 与 New folder 同时锁定；创建成功后的
重新列举及其子级预览全部结束前也保持锁定，避免对尚未落稳的目标继续操作。
嵌套创建对话框打开后，父浏览器整体进入 inert 状态；创建请求在途时 Escape、取消和遮罩点击均不
关闭子对话框。只有创建结算或整个浏览流程被强制关闭才解除锁定，确保不可取消的 Host 写入有唯一归宿。
初始 Home 列举失败时仍保留 Edit path 恢复入口：编辑器以空值打开，因缺少 Host 平台信息不进行
猜测式草稿预览，但 Enter 可把绝对路径直接提交。此状态下 Escape 退出编辑后会重新请求 Home，
而不是把浏览器永久留在没有目录栏位的死端。
路径表单内部的焦点移动不会结束编辑；焦点真正移到表单外时会按 Escape 语义撤销草稿及其扫描。
窗口自身失焦时 `document.hasFocus()` 保护编辑状态，切换应用再返回不会丢失路径或过滤结果；目录行
仍通过编辑态 mousedown 防抢焦点，由其选择动作显式接管并关闭编辑器。
目录行使用 listitem 外层座位包裹原生 button，辅助技术可同时识别列表结构和可操作控件；只有当前
选中项发布 `aria-current`。预览失败后若原行仍可见则焦点回到该行，只有点前缀临时显示的隐藏行因
失败重新隐藏时才退回 Edit path。双栏在窄视口横向溢出时会把新出现的右栏自动滚入视野。
每次启动或关闭后重开应用内目录浏览器，都以 Host Home 的无路径 `list` 请求建立全新视图；Add
Workspace 表单中已有的 cwd/路径不会污染浏览起点。用户仍可通过 Edit path 原文提交任意绝对路径。
目录浏览器的关闭按钮、面包屑导航和路径输入均使用双语 `aria-label`，语言热切换会与可见文案同步
更新；中文读屏不再在这三个关键控件上回退为英文硬编码。
Workspace 重命名与移除不再调用浏览器原生 prompt/confirm，而使用应用内受控对话框。重命名会阻止
空白、未变化和与其他 Workspace 重名的草稿，冲突就地显示；Host 失败保留草稿供重试。两种操作
在请求中都锁定输入、确认、取消、关闭与 Escape，避免重复提交；失败解除锁并保留对话框。
移除对话框明确说明只删除 Workspace 注册，目录、Session 日志都会保留且 Session 回到 Ungrouped；
成功后先等待 Host 列表刷新，再关闭对话框，避免旧 Workspace 画面泄漏到下一次操作。
工作区名称输入同样带 IME 合成保护，候选确认 Enter 不会误触发表单提交。
Session 重命名也改为应用内受控对话框：空白标题被阻止，但与当前显示标题相同的值允许提交，以便
把自动生成标题固定为显式标题。请求期间输入、确认、取消、关闭和 Escape 全部锁定；Host 失败后
保留草稿与内联错误供重试，输入修改会清除旧错误。中文 IME 的候选确认 Enter 不会触发重命名。
插件移除也使用应用内受控确认对话框，不再依赖浏览器原生 confirm；请求在途时确认、取消、关闭和
Escape 全部锁定，Host 或刷新失败会保留插件名称和内联错误，允许原位重试。

当前上游工作区包审计覆盖 250 个 `@deepseek-ai/dsh-*` 包。Seal 没有直接引用的 17 个包中，
`agent-loop-testkit`、`client-test-runtime`、`llm-mock-server`、`llm-replay`、`loader-smoke` 与
`session-snapshot` 是上游测试支撑；`typert-generator` 是上游生成器；Python code runtime、Inspector
和 Web Worker runtime/packer 是未进入已发布默认 Profile 的私有实验基础设施。公开的
`dsh-client-web` 负责静态模块表、Cordis Loader 与 renderer handoff；Seal 的认证感知 bootstrap
承担这一装配边界，并加载相同版本的官方 Client Controller 与 UI 包，因此它属于 Host 集成替换，
不是被静默省略的终端用户能力。Agent Team 包虽然没有发布到 npm，但其仓库源码约定已通过上表的
Seal 原生服务、工具和 Web 面板实现，不再把“未发布”当作功能阻塞。

- 第三方插件若依赖当前发布版官方壳未组合的专有 Host/Client 服务，仍需调用者通过 `services`
  为其 `inject` 项提供部署适配器；这属于开放式插件兼容边界，不是已发布 Web Profile 的缺项。
- Cordis Loader 本身不解析或安装包；`seal-harness plugin add` 会在隔离 Profile 中通过 pnpm
  安装运行时依赖，并允许 pnpm 按 Profile 的 `allowBuilds` 策略执行源码包的构建脚本。pnpm
  拒绝未授权的构建脚本时，应把其报告的准确包名加入该 Profile 的
  `pnpm-workspace.yaml`，再重新执行安装。配置与已安装源码的热替换已经支持。
- E2B 组合已实现并有本地契约测试，但没有 `E2B_API_KEY` 时不能完成真实远端沙箱 smoke；因此当前只能证明
  组合、生命周期和适配契约，不能证明外部服务端到端可用。
- Session telemetry 的上游默认值是 `FEEDBACK_ONLY`，Seal 出于本地隐私默认保持 `DISABLED`；能力和显式配置
  已兼容，但除非用户明确授权，不会把默认行为改成反馈后出站。
- 默认页面已使用发布版官方 renderer/theme/session/sidebar/conversation/settings 等组合，并通过真实 Chromium
  启动、完整视口、旧壳层隔离、零控制台/运行时诊断及零 HTTP 4xx/5xx smoke；尚未建立与上游截图基线的
  逐像素视觉回归，因此不宣称 CSS/字体渲染逐像素等同。

## 安全

DSH 插件与 Seal 原生插件一样，是拥有 Node.js 进程权限的可信代码。Policy/Approval
保护的是模型通过 ToolService 发起的工具调用，不能隔离插件在 `apply()` 中直接执行的
文件、网络或子进程操作。只安装可信来源的插件；需要进程级隔离时使用容器或单独进程。
