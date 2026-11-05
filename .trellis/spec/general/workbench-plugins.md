# 工作台插件契约

## 内置电脑操作

`computer-use`采用固定版本Cua Driver stdio MCP，支持默认本机与多个SSH虚拟机目标；唯一可见入口为settings.section中的“电脑操作”，不注册首页导航resource或conversation.input.left。设置页通过公开useSessions根选择器从retainedBy.mainView确定当前会话，并显示会话名称以提供原有启用/停止；没有当前会话时仅管理配置/检查，不能隐式创建或启动会话。账号配置保存在Host credentials grant，不存SSH密码或私钥正文。运行授权绑定account/epoch/session，不持久恢复；同一桌面目标不得被两个会话同时占用。退出、会话释放、目标修改/删除或卸载关闭所属连接；异步启动/挂载在取消后迟到的进程和scope仍须释放。

用户要求严格后台，执行桥只暴露已打开窗口的观察及输入：每次输入强制`delivery_mode=background`，要求准确pid/window_id，前台交付、全局desktop/pointer、剪贴板写、脚本和batch、bring_to_front及launch_app均拒绝。launch_app虽上游尝试恢复焦点，应用自身启动仍可能抢前台，不能作为严格后台能力承诺。后台不支持或无效目标直接失败，不自动或经其他工具绕过升级为前台。截图保留MCP图像内容块，经原生DSH附件/模型图像投影；不接受screenshot_out_file等路径将图像转存成只读文件结果。

Host credentials记录键必须通过官方credentialKey构造；账号UUID可能以数字开头，不得直接作为键段。电脑操作使用`account-`+账号SHA256段；测试须把真实数字开头UUID的保存记录交给原生parseCredentialsDocument重启解析，不能只用接受任意字符串的Map假provider验证持久化。开发期遗留的原始账号键在停机后备份并仅迁移本插件记录，保留其他refs/records和payload。

虚拟机在来宾运行Driver，经OpenSSH stdio带BatchMode和严格known_hosts；不自动接受指纹、不通过HTTP裸暴露桌面、不安装Hypervisor。WindowsSSH的Session0没有桌面，必须用同账号交互desktop daemon的named pipe；Linux要图形会话socket/环境，macOS保持已签名app及TCC身份。SSH客户端可用不等于远端桌面验证成功。默认本机不会隐式切换到VM；开启后目标一直明确显示。

构建按固定资产SHA256装配Driver及MIT/第三方通知到lib/runtime并随产品安装；版本/归档与exehash记录provenance，不运行上游安装器、技能安装、自更新或可选AGPL perception。当前0.38.0发布标记prerelease应诚实记录。运行依赖从productRoot解析，先复用Desktop安装图再回落仓库父级，不额外安装第二套运行时。

必需检查：真实MCP握手/工具发现，Native scoped tools与图像投影、账号/会话隔离、停止/取消/迟到清理；真实OpenSSH协议夹具/临时known_hosts且不碰用户SSH文件；后台输入及应用状态回读，同时采样系统鼠标和前台窗口保持不变。后台只成功发送不代表效果已验证。另执行产品build/check/Profile、随包资源与GUI。真实VM和macOS/Linux未实测时分别保留验收项。

## 1. 范围与触发

`token-stats`、`knowledge`、`remote-desktop`、`acp` 均为 `seal-harness-desktop/plugins/` 下独立 Host/Client 包，不并入根 Yarn workspaces。产品构建、Profile 和 check 同时登记。旧反馈入口保持禁用。

知识库、远程主机、ACP Client 通过 `ctx.inject(['sealHarnessNavigation'], callback)` 注册 `{ id, label, icon, order, primary: true, Panel }`，顺序为 110/120/130。Token 统计注册为 `settings.section`，不再占一级导航。一级导航顺序：首页、能力、知识库、自动化任务、远程主机、ACP、空间。问问决策暂不显示一级入口，原有页面注册与会话状态保留。能力二级菜单包含插件、技能、连接器、应用，并在市场可用时提供插件市场；保留原有 DSH 插件管理页和市场组件。能力四项不再进入首页资源列表。primary 不进入首页资源列表，卸载当前 primary 后回首页；非首页宽侧栏为零宽且不改写持久偏好。短窗口允许滚动一级导航，不压缩按钮尺寸。

知识库、远程主机和自动化任务采用左侧列表、右侧内容的分栏布局。远程主机左侧按当前账号的主机快照搜索、筛选和选择，右侧保留本机客户端状态及当前主机的连接、检查、编辑、删除操作；筛选或删除后不保留陈旧详情。自动化任务一级入口进入产品 `seal-harness-schedules`：左栏搜索/筛选/选择计划，右栏直接创建、编辑或查看执行记录。顶部和空态新建按钮均只打开表单；保存调用现有账号隔离save服务，显示真实任务及下次运行时间，不创建或切换会话。四种频率为once/daily/weekly/interval。到期或手动执行才由既有runner创建独立会话。原生 `schedules` 仍通过“查看会话提醒”访问，保留已有模型创建任务，不迁移或混合两套数据；该页仍高亮自动化任务导航。窄窗口上下排列，列表和详情仍可滚动。

除首页和决策外，独立内容页的排版由 navigation 的 `page-styles.js` 统一覆盖：一般页内边距32px，视口不超过800px时20px；知识库与远程主机外层无留白，右侧内容区使用该内边距，左栏直接贴一级图标轨道；自动化任务左栏固定宽度，右栏承载创建表单及详情。其他页滚动槽9px并在两边对称保留。主标题24px/32px、字重600，已有副标题14px/22px、字重400，间距8px，字体共用产品栈。上游自动化页保留原生单标题及操作，解除原960px居中上限。市场沿统一外层滚动，避免嵌套滚动条再次挤偏。不得用全局h1/p选择器影响首页、决策、弹窗或内部卡片标题；验证需逐页测量真实宽窄视口下的计算样式与左右间距。

## 2. 接口与存储签名

所有产品 RPC 沿现有 POST `/api/{module}/{action}` 的 client-request/server-response envelope，账号由 Host 当前 identity 提供，不能信任 payload 中的账号。标准结果为 `{ok:true,value}` 或 `{ok:false,error:{code,message,details:{}}}`。

| 模块 | RPC 前缀/动作 | 持久来源 |
| --- | --- | --- |
| Token | `seal-harness-token-stats/{snapshot,export}` | SQLite `token_usage_turns` |
| 知识库 | `seal-harness-knowledge/{status,bases,saveBase,deleteBase,models,documents,importText,upload,readDocument,deleteDocument,reparse,search}` | 当前账号的 WeKnora 服务 |
| 远程主机 | `seal-harness-remote-desktop/{snapshot,save,delete,check,connect}` | SQLite `remote_hosts`，原生客户端独立窗口 |
| ACP | `seal-harness-acp/{snapshot,save,toggle,delete,check,run,cancel}` | SQLite `acp_runners` + Host credentials |

local-data v7 统一创建用量及 Runner 表，不允许插件另建数据库或修改 PRAGMA。`token_usage_turns` 以 `(session_id,turn)` 唯一绑定 `user_id`，含 start/end 序号、时间、preset、route、完整/缺失状态与真实用量字段；`acp_runners` 以 `(user_id,id)` 为主键，`config_json` 不含环境秘密，秘密沿每账号 Host credentials。已有用户/组织/技能等数据须完整保留。

## 3. 行为契约

- **Token**：turn/start 持久绑定当前账号，turn/end 使用公开 Session Projection 及 `deriveTurnTokenUsage` 折叠真实事件；不扫描已弃用 Session 同步历史接口。重复/重放不重复计数，账号不能重绑定他人的历史轮次。total 采用上游计算结果，不再额外累加缓存；缺失缓存/推理等字段显示未提供。历史未归属、辅助请求和不完整用量不估算。时间范围最长 367 天，按用户选定 IANA 时区分组；真实 `.xlsx` 含汇总/每日/专家/模型四表，只导出当前账号筛选范围，不含对话内容或虚构费用。
- **知识库**：既有 weknora Host 提供内部 `sealHarnessWeknora.status/request`，每次获取当前账号凭据并核对 epoch。页面不接收 Key；管理请求拒绝重定向，响应上限 8MiB，文件上限 16MiB。服务端承担模型、OCR、索引与存储，不复制第二套 ONNX。retrieve/ingest/manage_kbs 分别控制读取/文档写/库管理；模型列表权限失败不能阻止只读浏览和检索。上传成功不等于解析完成，以服务端 parse_status 为准。
- 知识库一级页使用与能力相同宽度的左侧二级栏展示当前 Key 可见的知识库，右侧展示当前库的文档、检索和管理操作。空库、连接失败和未配置状态不得伪装为已有库；切换库时左侧选中态与右侧内容同步。左栏不写入持久侧栏偏好。
- **远程主机**：保留remote-desktop包名/id，入口为远程主机，移除本机截图/输入驱动。v8的remote_hosts按(user_id,id)保存主机名及SSH/RDP/VNC参数，不保存密码、私钥正文或口令。严格校验地址、端口和绝对文件路径；不接受附加命令。snapshot仅发现客户端，不发起远端网络连接；check显式进行有超时/可取消TCP探测，明确可达不等于协议认证成功；connect调用成熟原生客户端，不自写桌面协议。SSH为OpenSSH终端，Windows RDP为mstsc，其余RDP为FreeRDP，VNC为TigerVNC；缺失程序或交互终端给安装/指定路径说明。参数独立传递、不关闭主机或证书验证、不转发环境秘密。Windows交互终端以静态PowerShell broker和独立序列化数据启动；macOS以静态AppleScript和POSIX参数引用启动Terminal。仅显式连接打开可见窗口；已启动不报告为远端已登录。账号切换、配置编辑/删除、卸载或请求取消丢弃旧结果并中止探测；已交给用户的原生窗口不随Seal页面/账号关闭。
- **ACP**：复用公开 `ctx.subprocess` 与现有 `@agentclientprotocol/sdk@1.4.0` ACP v1 transport；`@deepseek-ai/dsh-acp` 是 Agent 服务端，不等于外部 Runner 客户端。区分发现程序、握手成功与执行完成；预设不自动安装/登录。模型工具为 `list_acp_runners`/`acp_runner`。工作目录明确且有效，进程剥离环境秘密；默认拒绝权限，显式策略才能允许 once 请求。停止、账号变化、禁用/删除与卸载均须取消并确认进程清理。Windows cmd/bat/ps1 若公共进程 seam 不支持，明确指导 node.exe + 实际 JS 入口，不能用未转义 shell 拼接绕过。

## 4. 校验与错误矩阵

| 边界 | 必需行为 |
| --- | --- |
| 未登录、跨账号 id、登录 epoch 变化 | 拒绝/丢弃旧结果，不回传另一账号数据 |
| 用量未知、日期无效、数值溢出 | 明确缺口或输入错误，不补造历史/价格 |
| WeKnora 未连接/401/403/索引未完成 | 区分状态，保留失败草稿与重试入口，不升级权限 |
| 主机不存在/地址非法/客户端缺失/端口不通 | 拒绝错误配置或给明确诊断；不假报登录成功 |
| ACP 程序缺失、协议不符、退出、超时、取消 | 区分可用性与执行终态，清理完成前不报告已停止 |

## 5. 基础、正常、错误案例

基础：新插件无记录时诚实显示空态；WeKnora 无 Key 时引导设置；没有主机时显示添加引导；未安装 ACP adapter 不显示就绪。

正常：真实用量事件跨重启汇总一次；有相应 Key 权限时导入文档并检索来源；用户选择远端配置打开对应原生客户端；受控 ACP Runner 完成握手、任务和输出。

错误：把 retrieve Key 用于删除库得到明确403；旧账号探测结果不能回传到新账号；另一个账号不能导出原账号统计或运行其 Runner。

## 6. 必需验证

模块定向测试覆盖真实 Cordis 用量事件→Projection→RPC、去重/重启/归属、Excel XML；知识库受控HTTP管理闭环、权限/取消/响应限额、UI确认；主机CRUD/重启/账号隔离、原生客户端argv与安全引用、真实本地TCP探测/取消/超时、保存失败草稿；ACP真实 fixture 子进程协议、取消/错误/清理及UI配置。

共享验证包括 v6→v7→v8 前向迁移及旧数据保留、导航顺序/晚加载/卸载、产品 build/check 与真实 Electron Profile，Windows 主机管理页面实测。测试夹具不代替真实 WeKnora/第三方 CLI 账户、真实SSH/RDP/VNC远端登录、桌面或 macOS/Linux 设备验收；分别报告未测范围。

## 7. 错误与正确做法

错误：画出截图样式卡片就报告功能完成，用零填补历史未知用量，返回 API Key，把客户端启动当成远端连接成功，或用普通命令 stdout 冒充 ACP。

正确：接真实生产者和协议，区分当前实现与外部依赖，用当前账号和生命周期约束操作，依靠隔离 fixtures 与真实 Profile 验证，并如实显示未就绪和未验证状态。

## 会话选择器与页面呈现

`office` 保留账号文档库 Host 及创建、导入、编辑、版本和导出 RPC，不再注册独立的聊天侧栏页面。原文档库 Client 组件仅供回归测试，不能作为用户当前的 Office 入口；修改文档库行为时仍须验证账号隔离、文件保留和结构化编辑限制。

工作区 Office 由 `workspace-word` 插件接入 DSH 的文件树、DOCX/XLSX/PPTX 文档预览和聊天轮次公开 slot。通过公开 sidebarRightTabs 的资源 patterns/canOpen 认领会话 DOCX/XLSX/PPTX，聊天卡片、文件树和本轮成功生成统一按官方 file resource 地址打开并去重；不能让卡片再次落入依赖 Office→PDF 的预览。既有文件预览中的“编辑”保留兼容入口，右侧资源页签继续使用同一未保存关闭保护。格式工具可展开且分组换行，窄侧栏不得依赖横向滚动。Office 文件在右侧打开会话页签，不占用聊天整页导航；DOCX 使用 Stratex 的 Word 模型与浏览器 GenOffice Worker，XLSX/PPTX 使用本地 GenOffice core 的有界结构化编辑。文件树当前目录可新建或导入三格式，编辑页签可保存原文件或导出字节。Host 限定当前本机会话工作区、账号 epoch、普通文件、大小和版本冲突，新建/导入拒绝覆盖。工作区文件不进入账号文档库、不创建库内版本；`office` Host 继续提供受限 worker 转换接缝。不能把结构化编辑宣称为 Stratex 完整的表格/演示渲染。

技能及连接器管理页和会话选择器共用 capability-shared/src/directory.js 的系统/个人规则。技能origin.kind为system/store时属系统，其余管理技能属个人；无管理记录的bundled/runtime属系统，工作区/用户目录属个人。连接器有catalogId或source时属系统，其余属个人。分类不改变运行时source、技能插入或连接器选择/权限。

原生会话技能目录DTO不含source。通过产品只读sessionSources路由从公开scoped skills服务读取来源，以name/path匹配目录；不按名称或路径猜测来源，不读取技能正文。查询绑定当前账号epoch、请求及插件生命周期，冷会话释放observation与preset lease；不占用技能管理写入队列，避免preset加载重入死锁。

Token页的直接子元素不参与纵向flex压缩，纵向滚动由页面承载，汇总表仅需横向溢出能力，不能压成独立小滚动框。知识库头部刷新/设置使用34px图标按钮，保留aria-label及title悬浮提示。远程主机不提供本机屏幕控制或mobile占位入口。


Office 资源页签从 `useTabInfo().tab.contentId` 读取官方 file address，不能从 navigation 中虚构 address 字段；自动打开和手动卡片必须使用同一 sessionFileAddress/openResourceIn 路径。纯工具包 `@deepseek-ai/dsh-util-workspace-path` 在 workspace-word 浏览器产物中显式 alwaysBundle，不向 DSH Client Loader 留下无 Client 入口的运行时 require。回归应模拟真实 tab.contentId，并拒绝浏览器产物新增非 React 外部依赖。真实检查覆盖新生成→自动打开、关闭→卡片/正文链接重开、重复打开去重、未保存取消关闭及落盘后重开；展开的格式工具在360/420/650px宽度不得横向溢出。

右侧开始页可由 `workspace-word` 通过公开 `sidebar.right.tab.guide` chain 插槽替换正文；DSH 继续拥有页签栏、布局和浏览器实现。工具卡片从 `sidebarRightTabs.guide()` 读取有效注册项，网址入口只在 browser 类型存在时显示，已打开文档从 `sidebarRight.openTabs` 按会话和 Office kind 筛选。标题应明确区分“已打开”与历史“最近”，不能用占位应用伪造推荐列表；点击文档用 `openResourceIn` 回到同一资源页签。

开始页网址栏右端的“更多设置”仅操作开始页本身及已注册的右侧工具，不能呈现 DSH Browser 尚未实现的网页查找、打印、缩放或浏览历史。菜单需可键盘访问、支持外部点击及 Escape 收起；不改 Browser 原生工具栏或浏览器安全边界。
