# Seal Harness 桌面构建契约

## 工程边界

根仓库直接继承 DSH Desktop；`deepseek-harness/` 是只读的固定提交子模块。产品身份、海豹图标、插件、bundle、Profile 与构建接入归 `seal-harness-desktop/`。它不是根 Yarn workspace，不安装第二套 DSH 运行时或创建第二份锁文件。优先使用上游公开服务、事件、slot 和插件组合。共享 Desktop 代码确需修改时，按根 `AGENTS.md` 执行 Beta 先行与双变体验证。

Node 要求 `^22.19.0 || >=24.0.0`，根 Yarn 固定 `4.18.0`。使用 `corepack yarn seal-harness:build` 编译产品插件并装配 Beta Desktop；`seal-harness:check` 是无图形产品验证入口；`seal-harness:start` 显式启动图形应用；各 `seal-harness:dist:*` 在目标操作系统打包。上游 `build` 与产品 `seal-harness:build` 共享编译目录，不并行运行。发布前仍按根发布流程准备 Agents Anywhere 产物，签名和跨平台安装分别实测。

`product.json` 是产品名、应用 ID、数据目录与更新渠道的来源。名称是 Seal Harness，应用 ID 是 `com.seal-harness.desktop`，默认 Home 是 `~/.seal-harness`；显式 `DSH_HOME` 覆盖保留。社区 DSH 更新渠道不得作用于产品。海豹图标原图和派生资源由 `assets/`、`icon-provenance.json` 和 `scripts/export-product-icons.py` 管理；保留 Git LFS 与来源记录。构建产物不入库。

原生远程控制确认弹窗由 Desktop Host 显示，不能通过网页品牌 slot 改写。其文案在 `remote-control-offer.ts` 从自定义 `DESKTOP_PRODUCT.name` 读取产品名；无自定义产品配置时保留上游 DeepSeek Harness 文案。此共享接缝必须同步 Stable/Beta，并分别验证中英文。

## 当前插件组合

构建顺序由 `seal-harness-desktop/scripts/build.mjs` 的 `productPlugins` 和 `cordis.patch.yml` 对齐。`local-data` 在 `identity` 之前加载，之后装配账号界面、能力插件和会话选择。项目、知识库和产品智能体插件不装配；保留 DSH 原生工作区、会话与 Agent 供普通对话和专家使用。删除插件时还需从已装配目录清理旧包，防止旧构建残留进入安装包。

`packages/dsh-plugin-ask-jev/` 是可单独打包并通过 `dsh plugin add` 安装的 DSH bundle。它使用公开的 Connection RPC、credentials、tools 和 Client slots，Host 固定 TypeSafe/阿里百炼端点并注册 `ask_jev_decide` 工具。原生 `settings.section` 承载决策模型与凭据设置；Client 在普通 DSH 中保留侧栏表单，在 Seal Harness 中借可选 `sealHarnessNavigation` 将一级入口接到原生会话。结构化决策工具只返回真实模型结果，自然语言解释由普通会话模型承担。产品构建先生成该包，再复制到 Beta 装配目录；安装包必须包含同一包的 Host、Client、patch、许可证。不要让此可复用包依赖 Seal Harness 身份或导航服务。
此独立包不加入根 Yarn workspaces，也不创建第二份锁文件；其构建复用已安装的 Beta Desktop 工具链。普通 DSH 安装后的 Host 不依赖 Seal Harness 私有服务或额外运行包，Client 仅依赖 DSH 提供的 React 模块。

`@seal-harness/navigation` 在专家/技能/连接器 Client 之前加载，提供 `sealHarnessNavigation` 注册服务。一级窄栏依次显示首页、问问决策、空间、定时任务；问问决策复用 DSH Session/Workspace 服务打开原生对话，重进时复用该会话，切换普通会话或点击首页则退出决策导航状态。首页侧栏同时显示专家、技能、连接器、插件等功能入口与 DSH 原生工作区及会话列表，不提供概览页或重复的会话菜单。顶部“新会话”按钮进入 DSH 对话，点击一级首页可返回当前对话。资源插件在自身 Client 生命周期内通过导航服务注册，导航插件用公开 `sidebar.panellist` 和 keyed `main` slot 组成入口与页面；仅问问决策从首页列表中排除并放入一级 rail。首页不覆盖 `sidebar.workspaces`；决策会话、空间、定时任务隐藏工作区列表。插件管理仍复用 DSH 原生 `plugins` 主面板，其侧栏行在首页由产品同 ID 注册覆盖，在其他一级菜单隐藏。产品样式在 Desktop frame 左侧预留窄栏宽度并补偿侧栏拖拽线；兼容/扩展/高级模式、窄窗口和三平台标题栏是回归重点。

设置与账号图标放在一级窄栏底部。导航插件只触发原生 `sidebar.settings` 设置按钮和产品 `sidebar.footer.action` 账号按钮；原按钮行在宽侧栏隐藏但保持挂载，因此设置弹窗、登录分支和用户详情页仍由各自插件管理。

`local-data` 在基础 Home 管理唯一的 `seal-harness.sqlite`。`users`、`experts`、`skills` 及状态、迁移记录表共用该库；历史 `projects` 表保留以避免删除已有用户数据。数据库版本用 `PRAGMA user_version` 顺序迁移，启用外键与 WAL。Host 插件通过 `sealHarnessDatabase` 共享连接和事务。数据库是用户、专家版本和技能包的持久来源；物化到文件系统的技能/专家目录是可重建缓存。自动迁移旧本地文件只复制、不删除原文件。

专家页只分“系统”和“个人”：系统内置专家尚未装配时显示空态，个人读取当前本机账号的 SQLite 专家，导入包也归个人。页面不提供已安装、公开目录、同步状态或手工创建/编辑页。创建专家按钮新建原生会话并填入可编辑模板，不自动发送；Host 暴露模型工具 `list_available_expert_capabilities` 与 `create_expert`，后者经当前账号和能力校验后复用专家 `create` RPC 保存。只有工具返回成功才能报告创建完成；重开个人页从 SQLite 读取，不依赖模型输出文本作为持久来源。

技能页保留独立的“已安装”区块，下方只有“系统 / 个人”页签；系统目录提供 cc-haha 的固定工具包和精选在线技能，具体契约见 capability-catalog.md。个人读取当前本机账号的 SQLite 技能，ZIP/目录导入仍直接安装但默认不启用。创建技能按钮新建原生会话并填入可编辑模板，不自动发送；Host 的 `create_skill` 模型工具走既有 `skills/create` 校验与持久化，将个人技能标记为未安装。用户从个人列表显式安装后才进入已安装区块和 DSH 运行时目录。旧技能状态未记录 `installed` 时按已安装解释，避免迁移时隐藏已有技能。技能页不显示同步状态，也不提供手工新建页；已有技能详情与文件编辑仍可用。

连接器页也使用独立的“已安装”区块及“系统 / 个人”页签；系统目录提供 cc-haha 的全部连接器配置与安装方式，具体契约见 capability-catalog.md。公开目录、被授权和同步状态不出现在连接器页，商店安装仍通过独立插件市场与现有 Host 接口执行。现有本地和商店连接器缺少 `installed` 字段时按已安装处理，凭据继续保存在 DSH Host credentials grant record。创建连接器按钮新建原生会话并填入可编辑模板，不自动发送；Host 的 `create_connector` 工具只保存当前本机账号的无凭据个人配置。未安装的个人连接器不注册工具，也不进入会话选择器、专家能力或流程资源；用户显式安装后，再通过既有管理面板配置凭据与启用。本地 STDIO 包导入仍沿用校验和安装流程。

`identity` 只提供本地用户名密码认证与首次管理员创建，密码以独立 salt 和 scrypt 哈希存储。会话仅驻留 Host 内存。企业微信、SSO、远端密码和记住登录不属于当前产品。专家、技能状态与包按用户存入 SQLite；知识库绑定和云端目录不属于默认 UI。DSH 原生工作区与会话历史由上游管理，产品不提供项目管理插件。

品牌 Client 使用上游公开的 `settings.models.footer` 槽，为手动列出的 pi-ai 模型提供逐模型推理档位设置。使用 `remote.settings.describe/mutate` 读取和写入原有 Profile 的 `reasoningEfforts`，对模型数组做最小字段变更并以 namespace revision 拒绝并发覆盖。用户须依据服务商文档填写实际 wire 值；产品不从供应商名称推断推理能力，也不向远端探测。未声明能力的模型在对话菜单中继续不显示推理档位。

模型选择菜单的分组标题由上游 CSS 设为粘性半透明层；长列表滚动时下方模型文字会透出。品牌 Client 只在该菜单的滚动分组标题上叠加与原菜单色一致的实底，不修改只读上游子模块，也不影响模型选择或推理等级逻辑。

Seal Harness 不显示上游 DeepSeek Harness 的内测声明。品牌 Client 通过公开的 `settings.onboarding` 槽，以更低优先级覆盖 `welcome-notice` 并调用 `complete`，让引导继续；不修改上游源码，也不写入用户的声明确认状态。

## 定时任务契约

### 1. 范围与触发

`@seal-harness/scheduled-tasks` 是产品自有插件，在 identity/navigation 后装配。导航继续拥有已有一级入口，任务插件注册其内容，不重复增加首页资源入口。Host 使用 `sealHarnessDatabase` 的 v3 表，任务和查询按当前本地账号隔离；应用启动将尚未结算的 running 记录标记 interrupted。

### 2. 接口与存储签名

POST `/api/seal-harness-scheduled-tasks/{action}` 使用现有 client-request/server-response RPC envelope。`list` 接收 `{}`；`save` 接收 `{ id?, name, prompt, workspaceId, schedule, enabled? }`；`runs/delete/run/stop` 接收 `{ id }`；`toggle` 接收 `{ id, enabled }`。结果为 `{ ok: true, value }` 或 `{ ok: false, error: { code: 'scheduledTaskFailed', message, details: {} } }`。

`scheduled_tasks` 保存账号、工作区、schedule JSON、启用状态和下一次时间；`scheduled_runs` 保存任务快照名称、唯一 session_id、session_available、fire_key、status、开始/结束时间与错误。`UNIQUE(task_id, fire_key)` 防止重复自动触发，partial unique index 禁止同任务多个 running 记录。

### 3. 请求与执行约束

执行频率支持 daily、weekly、interval、once。daily/weekly 保存 IANA 时区并按当地时间计算，夏令时不存在的分钟跳过、重复分钟同日只运行一次。运行中每 10 秒检查，超过 60 秒的过期触发只推进；启动和账号变更重新计算过期计划，不补跑未登录、关闭或休眠期间的执行。

`schedule` 为 `{ kind: 'daily', time, timeZone }`、`{ kind: 'weekly', time, timeZone, weekdays }`、`{ kind: 'interval', minutes }` 或 `{ kind: 'once', at }`。时间戳返回 epoch milliseconds，once 输入为 UTC ISO 字符串，日/周计划的 time 为 `HH:mm`。`list` 返回任务数组及各自 lastRun，`runs` 返回最近 100 条运行记录；会话创建成功才公开 sessionId。

自动推进计划和领取运行记录同 SQLite 事务提交；每个任务只允许一个 running 记录。预先保存唯一会话 ID，通过公开 `sessionController.create/rename/prompt/cancel/resolveAgent` 创建及执行原生会话，不启动另一套 CLI。等待 `turn/end` 和 Agent `whenIdle()` 后结算；取消/超时使用原有取消接口，权限策略和默认模型保持原生选择。记录仅保存状态与会话引用，完整输出由上游会话持久化。关闭插件清理定时器、账号订阅和正在执行的任务。

### 4. 校验与错误矩阵

| 边界 | 行为 |
| --- | --- |
| 未登录、跨账号 ID | 拒绝任务读写或执行 |
| 名称 1–120 字符、提示词 1–30000 字符、现存 workspaceId | strict schema 校验；不接受调用方指定账号 |
| daily/weekly | 校验 HH:mm、有效时区；weekly 至少一天，日编号 0–6 |
| interval / once | 间隔为 1–10080 整数分钟；启用的 once 必须在未来 |
| 同任务运行中 | 拒绝手动重复运行和删除；自动触发推进计划但不重叠 |
| 模型错误、取消、超时、重启 | 分别记录 failed/cancelled/timeout/interrupted，原生会话保留 |

### 5. 正常、基础与错误案例

基础：每天 Asia/Shanghai 09:00 执行，下一次保存为对应 UTC 时间。正常：暂停后手动运行仍可新建独立会话，执行记录可打开该会话；删除计划只删除计划/记录。错误：一次执行时间已经过去、工作区消失或另一账号请求任务 ID 时明确拒绝。

### 6. 必需测试

回归覆盖 v2 迁移、账号隔离、重启恢复、重复/重叠防护、时区与夏令时、实际 RPC 提示词、取消等待和页面创建/运行/记录/删除交互。产品 build/check 和 Profile 激活仍是必需门禁；真实模型执行与跨平台安装分别记录。

### 7. 错误与正确实现

错误：在 SQLite 事务内先创建外部会话，随后提交数据库；提交失败会留下无记录的执行。正确：事务内只推进时间和领取记录，提交成功后再调用会话服务，并测试回滚时外部执行次数为 0。

## 验证

每次修改产品装配后运行 `corepack yarn seal-harness:build`、`corepack yarn seal-harness:check`，并检查 `scripts/verify-profile.mjs` 的实际插件组合。数据库迁移测试须覆盖原文件保留、重启后从 SQLite 恢复、不同用户隔离。认证测试须覆盖首次创建、错误密码、会话退出与重启、改密。产品包核对 `lib` 与装配目录没有已删除的项目、知识库及产品智能体模块。构建/类型检查不等于真实 UI、模型回复、签名安装或跨平台通过；各自记录实测范围。

只提交本任务路径。遵守根 `AGENTS.md` 的版本规则：普通迭代仅递增补丁号；中间/主版本变更先取得用户明确同意。提交、推送和发布分别按授权执行。
