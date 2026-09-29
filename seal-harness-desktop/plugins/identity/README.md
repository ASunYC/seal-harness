# Seal Harness身份插件

标准 DSH `0.1.7-alpha.2` Host + React Client。产品组合须先加载 `@seal-harness/identity`，再加载用户、capabilities、projects 和 project-agent。Host 依赖 `connection`、`credentials`；Client 在未登录时占据 `root` 呈现登录页，认证后让出官方工作台。登录后的侧栏入口和详情由独立 `@seal-harness/user` 插件负责。

启动时自动恢复已保存的登录，验证成功直接进入工作台；无有效登录时显示登录页。身份服务可连接时需要登录；网络失败或 5 秒超时后提供“跳过登录”，未配置身份服务时提供“进入本地工作台”，点击时再次检查状态。任何 HTTP 响应（含 401、404、503）都代表地址可连接，不把账号错误或 Host RPC 故障当作断网。进入本地工作台后左下角显示“未登录”，点击可再次登录。网络恢复不会自动遮挡工作台；退出登录也保留本地工作台。

Seal Harness原数据根作为未归属旧数据保留；新启动使用其 `login/` Home，认证后按身份服务地址与服务端用户 ID 切到 `accounts/<哈希>/`。切换由原生进程完成、重启旧 Host，再由新 Host 向服务端复核一次性加密交接。退出登录或在账号 Home 选择离线跳过时，先切回 `login/` 并重启；离线工作台只使用中性 Home，不显示上个账号的会话。Electron 持久渲染器存储也分账号隔离。旧共享会话不会自动出现在任何新账号下，导入需单独设计并获得用户明确选择。

Host 不对全部本地 `/api` 请求增加远端身份门禁。原有 DSH 连接认证保留；项目和商店在各自业务边界校验身份，本地技能/连接器/专家可离线使用。`seal-harness-identity/status` 仅读取本地状态，不发外部请求。`seal-harness-identity/availability` 显式探测配置的身份地址，返回 `{ server: 'reachable' | 'unreachable' | 'notConfigured', sso, wecom }`；无凭据、不跟随重定向。Client 共用身份订阅和单个 5 秒轮询；启动登录页同时重新探测连接，暂时失败的保存登录在服务可达后自动重试。跳过、退出或主动开始其他登录后停止自动恢复。旧探测不能覆盖新登录状态或 SSO/企微事务阶段，登录和切号不重载页面；项目通过原有账号事件更新，商店通过账号/epoch 变化清理旧页面状态。一次性交接仅在系统安全存储可用时落盘密文并限时使用；Linux 缺少安全存储或退回 `basic_text` 时不保存临时令牌，仍切换到空的账号 Home 并提示再次登录。

## 服务配置

集中使用基础数据根 `~/.seal-harness/services.yml`（显式 `DSH_HOME` 可选另一基础根）；登录 Home 和账号 Home 共用这份服务地址选择，但各自的会话、Profile、用户配置和凭据留在各自 Home。唯一选文件变量为 `SEAL_HARNESS_SERVICES_CONFIG`；设置后文件不存在会明确报错。逐项优先级为插件 `services` > 文件 > 产品默认。改动后重启应用。

复制 [services.example.yml](services.example.yml) 后逐项配置需要使用的服务。地址可保留反代子路径，不加 `api/v1`；空字符串表示未配置。Seal Harness 默认不会连接来源工程的 Geovis 或内网服务。配置错误报告文件和字段，不静默切换环境。“服务连接信息”显示每项生效地址和来源。

连接测试身份服务时，先在独立的 [services.test.example.yml](services.test.example.yml) 填写实际测试地址；在 PowerShell 从仓库根目录运行：

```powershell
$env:SEAL_HARNESS_SERVICES_CONFIG = (Resolve-Path '.\seal-harness-desktop\plugins\identity\services.test.example.yml').Path
corepack yarn seal-harness:dev
```

`SEAL_HARNESS_SERVICES_CONFIG` 优先于基础根配置文件，插件显式 `services` 仍有最高优先级。手动修改地址后需重启；知识库页面的服务切换即时生效。登录失败绝不自动切到另一个环境。测试示例所有地址均留空，要测试业务服务须逐项填写对应环境的地址。旧 `~/.seal-harness/sessions` 保持原位，**不会自动归属首次登录者**；完整跨账号桌面交互仍需真实账号验收。

| 字段 | 产品默认 | 用途 |
| --- | --- | --- |
| identityBaseUrl | 空 | 身份与统一认证 |
| collaborationBaseUrl | 空 | 项目协作 |
| storeBaseUrl | 空 | 能力商店 |
| mcpCenterBaseUrl | 空 | 连接器中心 |
| knowledgeBaseUrl | 空 | 独立知识库 |
| knowledgeTargetType | `standalone` | `standalone` 使用 v1，`platform` 使用平台知识接口 |
| terminalBaseUrl | 空 | 远端智能体实例 |
| workflowRuntimePackDirectory | 空 | 流程智能体部署发行包；空值使用产品附带资源 |

部署目录的相对路径以配置文件所在目录解析，插件覆盖也遵循同一规则。账号页显示配置文件、有效值和来源，服务插件从 `sealHarnessServices` 取值，不另读模块环境变量。知识库的额外服务列表 `knowledgeServices` 和选择项 `activeKnowledgeServiceId` 也写入同一份 YAML；默认服务仍由表中的两个知识字段决定。切换时通知知识库插件取消旧请求并更换凭据上下文。客户端注册凭据由 DSH credentials 持有，不写入服务配置。

来源工程的远端协议与运行包仍保留在相关插件中，以便在获得合法服务地址后复用；它们不构成 Seal Harness 的默认连接目标。外部流程部署前应核对运行包内的镜像来源与访问权限。

## Host 契约

账号隔离依据身份服务与用户 ID 选择独立 Home，不对应操作系统用户。产品按系统默认权限创建目录和状态文件，不检查或强制 POSIX 权限位，账号目录允许使用链接；正常数据目录无需先执行 `chmod` 才能启动或切号。

`account-home` 启动入口的 `prepareAccountHome` 在 Profile/Host 加载前返回 Home、Desktop Profile 状态路径和渲染器分区；目录布局、服务配置环境变量和中英文目录说明都由身份插件维护。Desktop 只应用启动结果和显示通用窗口。Seal Harness另通过 `product.json` 的 `setupWizardEnabled: false` 关闭首次向导。登录/退出的账号选择与延后重启由原生 runtime 一次调用完成，直接 Host 和隔离 Host 使用同一逻辑。

```js
ctx.sealHarnessServices.getConfig()
// 服务地址、知识库协议类型、部署运行包目录；字段见上表。
ctx.sealHarnessServices.getKnowledgeConfiguration()
// { activeServiceId, services: [{ id, name, baseUrl, targetType, builtIn }] }
await ctx.sealHarnessServices.saveKnowledgeService({ name, baseUrl, targetType })
await ctx.sealHarnessServices.activateKnowledgeService({ serviceId })
await ctx.sealHarnessServices.deleteKnowledgeService({ serviceId })
const removeServicesListener = ctx.sealHarnessServices.subscribe(config => {})
ctx.sealHarnessServices.getDiagnostics()
// { file, entries: [{ key, value, configured, source: 'plugin'|'file'|'default'|'profile' }] }

ctx.sealHarnessIdentity.getSession()
// 同步 { accountId, epoch, accessToken, subject } | null
await ctx.sealHarnessIdentity.getAccessToken() // Promise<string>，有效直接返回，临近过期才刷新
await ctx.sealHarnessIdentity.refreshSession() // Promise<void>，强制刷新；并发请求共享一次刷新
const unsubscribe = ctx.sealHarnessIdentity.subscribe(() => {})
```

`accountId = JSON.stringify([完整规范化 identityBaseUrl, user.id])`；反代子路径参与账号隔离。登录尝试、退出和切号推进 `epoch`，正常 refresh 不变。在飞请求以内部 generation 判断是否仍属于当前账号；旧账号结果不能发布为新账号状态。消费方在每次异步操作后检查账号与 epoch。

请求令牌统一用 `getAccessToken()`：读取 JWT `exp` 的秒级到期时间，沿用 Stratex 的五分钟提前刷新窗口；有效时不发网络请求，临近或已过期时复用 `refreshSession()` 单飞刷新。没有本地猜测的固定 token 缓存时长。无登录时拒绝为 `sessionExpired`，刷新中切号拒绝为 `staleOperation`。远端 401 的重试仍显式调用 `refreshSession()`。

HTTP 协议来自 Stratex `c656400bc4baf80733a9ac5d8a1440539126c7e0` 的 `src/main/services/auth/aepPasswordProvider.ts`、`src/shared/protocol/auth.ts`：

| 操作 | 请求 |
| --- | --- |
| 密码登录 | `POST api/v1/auth/login { username, password }`，随后 `GET me` |
| 刷新 | `POST api/v1/auth/refresh { refreshToken }`，支持可选 refresh token 轮换 |
| 当前资料 | `GET api/v1/auth/me`，Bearer；过期时刷新并重试一次 |
| 退出 | `POST api/v1/auth/logout { refreshToken }`，Bearer；先清除本机状态 |
| 改密 | `POST api/v1/auth/password/change { currentPassword, newPassword }`，Bearer；提交前通过 `getAccessToken()` 取得有效令牌 |

停用账号不能建立或刷新登录。临时网络失败保留当前会话；明确失效或停用清除会话。退出时远端不可达仍清除本机登录，RPC 返回 `remoteRevoked: false` 表示远端撤销未确认。没有注册、找回密码、编辑资料等不存在的协议。

Client 通过已认证 Connection 上明确的 `seal-harness-identity/*` RPC 操作身份，仅接收基本资料、保存状态及服务诊断。不会接收 access/refresh token。

## 记住登录

按本任务最新要求直接使用公开 `credentials.describeRecord/readRecord/modifyRecord/deleteRecord`，不增加 OS 保护适配。记录键为 `seal-harness-identity/session-<identity 根地址 SHA256>`，grant 内容是 `{ baseUrl, session }`。默认 credentials-local 将它放在 `DSH_HOME/.credentials.yaml`；这是用户目录中的凭据文件，**不是 OS 加密存储**。密码不保存。

账号、SSO 和企业微信登录默认勾选“记住登录”，Host 在省略 `remember` 时也默认保存会话，刷新时替换同一记录。登录方式共用保存选项；企微等待扫码时可通过 `wecom/remember { remember: boolean }` 修改当前事务的保存偏好，不重建二维码。开始交换登录结果后不再修改该事务。SSO 等待认证时也可通过 `sso/remember { remember: boolean }` 修改保存偏好。未勾选时只保留内存并清除旧记录。退出和切号清理记录；不可写时明确显示仅本次运行。Host 启动时自动通过真实 refresh 验证已保存凭据，再向业务插件提供身份。网络失败、超时和 HTTP 服务错误保留记录并分别提示；`restoreErrorCode` 标识恢复失败类型供启动页重试，成功后清除错误。明确失效或停用才清除记录并重新登录。自动恢复沿用认证请求的 10 秒超时，失败不阻止插件启动。

## 统一认证与企业微信

已复用 `netauth/status`、`netauth/desktop/start`、`netauth/desktop/complete` 的真实协议；Host 生成 state/PKCE，打开系统浏览器，消费一次回跳，再经 `me` 接入同一身份状态机。Desktop 原来仅暴露目录选择等原生操作，没有登录所需入口，因此在现有 `desktopRuntime` 与 HostRpc 中增加最小接缝：

```ts
desktopRuntime: {
  protocolScheme: string | undefined
  openExternal(url: string): Promise<void>
  onProtocolUrl(listener: (url: string) => void): () => void
  openLoginWindow(options: { url: string, completionUrl: string, title: string }, signal?: AbortSignal): Promise<unknown>
}
```

原生 `open-url`、冷启动 argv 和 `second-instance` 统一交付 Host 订阅者。scheme 取产品构建配置 `protocolScheme`，共享层无Seal Harness硬编码；Seal Harness产品设为 `seal-harness`，回跳为 `seal-harness://auth/netauth/callback`。产品打包声明对应 `protocols`，服务端仍需允许这个 return URI。未通过用户真实授权，不把协议夹具当作真实 SSO 验收。原版上游没有 scheme 配置时保持不登记。

企业微信复用 `wecomEmbeddedProvider.ts`、`wecomEmbeddedContract.ts` 和 `wecom-login-probe.ts` 的真实链路。启动登录页右栏通过 Desktop 的受控 `WebContentsView` 载入身份根地址下的 `internal/auth/wecom-probe`，不使用 iframe 或假二维码。截获该页的 `api/v1/auth/wecom/complete` POST 后，用同一个临时 Cookie session 提交 `{ code, state }`；完成响应直接回 Host，经资料验证后进入与密码登录相同的保存、刷新、切号路径。成功、返回账号、关闭或插件卸载会移除视图并清理临时 session。工作台内重新登录时使用公开的独立登录窗口，避免全窗口坐标与侧栏布局冲突；离开账号页会取消尚未完成的企微窗口。`wecom/start` 的 `embedded` 参数默认为 `true`，账号页传 `false`。取消 SSO/企微仅中止该流程，不退出已完成的会话。“刷新二维码”复用 `wecom/start`，取消旧事务并创建新的隔离登录窗口/视图，重新加载配置和二维码，保留当前保存偏好；旧事务的迟到结果会被丢弃。

企业微信根据已配置身份根地址下的 `api/v1/auth/wecom/probe/config` 是否返回 200 及桌面窗口能力决定可用性，不限定正式域名。登录页、完成接口和原生视图身份来源同样取配置根地址，保留企业微信来源白名单。Netauth 按所选服务的 `netauth/status` 判断。

2026-09-23 只读请求确认正式 `netauth/status` 为 200 且 `enabled=true, desktopFlow=true`，企微 `probe/config` 与登录页均为 200。开发版已实测真实二维码内嵌显示、返回账号后销毁、再次打开与取消；实际扫码授权、服务端 return URI 允许列表及安装包 OS 回跳仍需有授权的交互验收；没有修改远端配置。

## 验证

```sh
node --test seal-harness-desktop/plugins/identity/tests/*.test.mjs
```

复用产品/桌面现有依赖，无单独安装或锁文件。协议测试使用本地 HTTP 服务与真实 DSH Context、HostConnection、LocalCredentials；覆盖登录/刷新/改密/退出、保存恢复、停用、refresh 单飞/轮换和延迟结果切号隔离。Client 测试编译真实 React 源码，验证表单、状态和卸载。

共享接缝在 Beta 验证后同步 Stable，专属检查为 `desktop-login.spec.ts`、`host-runtime-bridge.spec.ts`、`electron-runtime.spec.ts`、`product-config.spec.ts` 与 `plugin.spec.ts`，并运行两包类型检查和 `check:desktop-variants`。本机真实 Electron + 本地 HTTP 夹具已验证原 Cookie 交换、关闭、取消及零遗留窗口。

已使用用户提供的 250 测试账号分别验证 Platform 密码登录、资料读取及远端退出；未把凭据或令牌写入仓库。真实 SSO/企微授权、A/B 账号桌面切换及 Windows/macOS/Linux 安装验收尚未完成。
