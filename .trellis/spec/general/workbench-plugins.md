# 工作台插件契约

## 1. 范围与触发

`token-stats`、`knowledge`、`remote-desktop`、`acp` 均为 `seal-harness-desktop/plugins/` 下独立 Host/Client 包，不并入根 Yarn workspaces。产品构建、Profile 和 check 同时登记。旧反馈禁用与市场一级导航保持。

Client 通过 `ctx.inject(['sealHarnessNavigation'], callback)` 注册 `{ id, label, icon, order, primary: true, Panel }`；四项顺序为 100/110/120/130。一级导航顺序：首页、问问决策、自动化任务、Token 统计、知识库、远程主机、ACP、空间、插件市场。primary 不进入首页资源列表，卸载当前 primary 后回首页；非首页宽侧栏为零宽且不改写持久偏好。短窗口允许滚动一级导航，不压缩按钮尺寸。

除首页和决策外，七个一级内容页的排版由 navigation 的 `page-styles.js` 统一覆盖：页内边距32px，视口不超过800px时20px；滚动槽9px并在两边对称保留。主标题24px/32px、字重600，已有副标题14px/22px、字重400，间距8px，字体共用产品栈。上游自动化页保留原生单标题及操作，解除原960px居中上限。市场沿统一外层滚动，避免嵌套滚动条再次挤偏。不得用全局h1/p选择器影响首页、决策、弹窗或内部卡片标题；验证需逐页测量真实宽窄视口下的计算样式与左右间距。

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

技能及连接器管理页和会话选择器共用 capability-shared/src/directory.js 的系统/个人规则。技能origin.kind为system/store时属系统，其余管理技能属个人；无管理记录的bundled/runtime属系统，工作区/用户目录属个人。连接器有catalogId或source时属系统，其余属个人。分类不改变运行时source、技能插入或连接器选择/权限。

原生会话技能目录DTO不含source。通过产品只读sessionSources路由从公开scoped skills服务读取来源，以name/path匹配目录；不按名称或路径猜测来源，不读取技能正文。查询绑定当前账号epoch、请求及插件生命周期，冷会话释放observation与preset lease；不占用技能管理写入队列，避免preset加载重入死锁。

Token页的直接子元素不参与纵向flex压缩，纵向滚动由页面承载，汇总表仅需横向溢出能力，不能压成独立小滚动框。知识库头部刷新/设置使用34px图标按钮，保留aria-label及title悬浮提示。远程主机不提供本机屏幕控制或mobile占位入口。
