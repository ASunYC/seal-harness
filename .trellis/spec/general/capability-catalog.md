# 系统技能与连接器目录

## 1. 范围与触发

cc-haha 来源固定为 0a3b549d5ec020569d766a7c16ce209c6110af51。目录快照覆盖 55 项连接器（43 MCP、3 CLI、9 技能包）、398 在线技能；9 包共 29 项技能/436 文件。系统页签承载目录，既有个人/已安装管理保留。只迁入产品插件，不依赖 CC 的 Claude 运行时或用户配置。

## 2. 接口签名

既有 `/api/seal-harness-capabilities/{module}/{action}` RPC 增加：

- connectors/list：`{ items, catalog, capabilities, identityNotifications }`。
- connectors/installCatalog：`{ id }`；CLI 准备受校验的程序，MCP 保存配置，技能包委托 skills 安装。
- connectors/nativeAuthorize：`{ id, revision }` → `{ phase, url }`；nativeStatus/nativeCancel 接收 `{ id }`，必须验证当前账号可见性。
- skills/list：新增 `catalog`，条目包含 installed/installedCount/skillCount。
- skills/installCatalog：`{ id, expectedRevision }`，id 为 `bundle:<id>` 或 `<source>:<owner>:<slug>`。
- Host `sealHarnessSkills.catalogStatus(accountId)` 同步返回目录安装计数。该读操作不可进入管理队列，避免技能依赖安装与连接器 list 互相等待。

## 3. 数据与持久化

快照、SVG 原字节、所有来源哈希与文件 pin 保存在 capability-shared/catalog；CLI 源码/许可在 vendor/cc-haha，唯一源码适配为相对 import 扩展名。构建把许可、NOTICE 和 provenance 复制到 connectors/skills 的 lib/third-party，安装包不得遗漏。

连接器 configSchema 新字段：catalogId/nativeCli，headerPrefixes、queryParameters（静态参数）、queryCredentials（秘密）、requiredQuery。保存 RPC 只接受 queryValues；目录/CLI 标记不可由任意 save 请求添加。URL 本身仍不包含 query；remoteUrl 仅在 SDK 传输时组装。公开 DTO 只返回已配置的 query 名称，不能返回值。Bearer 前缀按目录声明组装，不重复添加。

系统连接器配置 id 含账号哈希后缀，ownerAccountId 通过现有 credentials grant 隔离。技能保存在现有 per-user SQLite 和可重建缓存；origin 保存目录 ID、作者/许可和实际版本。安装固定包完整下载并校验 pin，根许可与共享资源加入技能副本；在线包保留完整清单及 SEAL-SOURCE 来源文件。任一下载/校验失败不得写入已安装状态。

## 4. 校验与错误矩阵

| 场景 | 行为 |
| --- | --- |
| 未登录/跨账号 | 拒绝安装、授权、读取操作状态；不导入旧应用凭据 |
| 未知 catalogId/不支持的 CLI 架构 | 明确拒绝；不得执行猜测的程序或 endpoint |
| 缺 API Key / OAuth | 保持 disabled 或 unconfigured；不能报告可用 |
| 网络失败/429/5xx | 有界重试；失败后保持未安装 |
| 文件 path 越界、超限、摘要不匹配 | 拒绝整个包，沿用现有包校验和回滚 |
| CLI 授权 URL | 沿用上游供应商域名校验；取消/退出账号/卸载停止正在进行的授权 |
| query 认证 Workflow 导出 | 明确不可独立部署，避免静默漏掉认证 |

## 5. 正常、基础、错误案例

基础：腾讯地图安装后 URL 为无查询参数的原官方地址；静态 format=0 与 Key 分开保存。正常：用户填入 Key 并启用后，只在传输 URI 加入编码后的参数，返回 JSON 不含 Key。错误：错误作者/文件清单/摘要或离线下载不得用同名描述卡片代替实际安装。

CLI 安装与账号授权、技能安装与运行库准备分别处理。安装 Remotion/HyperFrames 技能不代表安装渲染器；页面必须保留来源 requirements。

## 6. 必需测试

全量条目/唯一 ID、55 原始 SVG 哈希、43 协议转换、29 技能 pin、vendor 源码逆向扩展名后哈希；query/Header 凭据保存/清除/编码/公开 DTO；账号独立 id；下载包含许可/参考文件且错误回滚；SQLite 与真实 Skill Registry 注册；native CLI 经普通 ToolRuntime 执行与每次程序校验；页面全量展示/详情/安装/既有凭据管理；既有跨模块队列安装回归。产品 build/check/真实 Profile 激活必须通过。

## 7. 错误与正确做法

错误：为了显示安装状态，在 connector 管理队列里等待 skills.list；skills 的依赖安装又可能等待 connector，造成死锁。正确：按账号同步读取 catalogStatus；有副作用的安装继续沿原独立 hostHandlers 流程。

错误：把 Key 拼进可公开的 URL 或只迁移目录名称。正确：秘密使用 grant 的私有字段，传输时组装；迁入真实端点、授权/程序 pin、完整技能资源及许可。
