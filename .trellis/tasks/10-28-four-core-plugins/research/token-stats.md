# Token 统计实现记录

## 接入与边界

- 模块：`seal-harness-desktop/plugins/token-stats/`，Host 名称 `@seal-harness/token-stats`。Client 注册 `id=token-stats`、`label=Token 统计`、`icon=usage`、`order=100`、`primary=true`。
- 父智能体已将模块 `src/schema.js` 的 `tokenStatsSchema` 合入 local-data v7。模块不自建表、不另建数据库。
- Host 必需服务：`connection`、`sealHarnessDatabase`、`sealHarnessIdentity`、`sessionProjections`；事件监听 `session/event`。Client 必需 `slots/connection/sealHarnessAuthClient`，通过 `ctx.inject` 处理导航服务晚到。
- `@deepseek-ai/dsh-token-meter/client` 公开导出 `deriveTurnTokenUsage`，可在 Host 调用。它对准确总量、缓存、重试和完整生命周期做严格核对。`@deepseek-ai/dsh-llm/assistant-stream` 的 `lastAssistantStreamChunk` 读取最终提供方用量。
- 新代码不能使用 `Session.snapshotEvents/eventAt/ownEvents`：上游 `.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md` 明确禁止新增生产调用。因此实现独立的 host-only 投影 `sealHarnessTokenStatsTurn`，只维护当前轮生命周期和用量字段。无提示词/回复/工具内容复制，无同步全日志扫描。

## 数据语义

- `turn/start` 持久绑定 `(session_id,turn)` 到当时账号。重复事件不能改账号。`turn/end` 根据公开投影的可证明 usage 将状态从 pending 改为 recorded/unavailable；结算重复到达不重复累计。
- 持久账号归属加框架投影重放支持跨重启/热重载。没有归属的历史轮次不自动导入；界面显式解释统计起始边界。
- 总 Tokens 使用提供方准确总量，已经包含缓存，不重复求和。缓存与推理未全部提供时保留 NULL/“未提供”。推理是输出子集。多路由同轮保留合并标签，缺路由显示“未提供模型归因”，不估算拆分费用。
- 查询按当前账号、日期和 IANA 时区严格限制，日期包含首尾，最长 367 天；可按原生 preset 和模型筛选。`pending` 显示“未结算”，避免把崩溃后未恢复的轮次误报为仍运行。
- RPC：`POST /api/seal-harness-token-stats/{snapshot,export}`，标准 envelope；不接受调用者自报账号。`export` 返回真实 XLSX 的 `{filename,mimeType,base64}`，四张工作表为汇总/每日/专家/模型。
- Excel 复用现有 `adm-zip`，生成最小 OpenXML，文本单元格不生成公式，附统计范围。没有新增根依赖。

## 验证

运行 Node 24：`--test plugins/token-stats/tests/client.test.mjs plugins/token-stats/tests/host.test.mjs plugins/token-stats/tests/usage.test.mjs`（实际执行使用仓库完整路径）。8 项全部通过。

- 真实 Cordis `SessionStore + SessionProjectionRegistry` 事件驱动到 RPC，未用假的累计指标代替真实fold。
- 插件 dispose/reapply 后投影 key 可重新注册、事件监听不重复，18+5 正确累计为 23。
- 缓存只计一次、最终usage优先、重试尝试合计、缺失字段NULL、无完整生命周期不造数据。
- 跨重启保留归属、重复start不能重新绑定账号、未登录查询/导出拒绝、另一账号无法取得记录、未归属历史排除。
- 实际 `.xlsx` 解ZIP及XML解析，四张工作表、数值170和日期内容正确；以 `=SUM(A1)` 开头的专家名称仍是 inline string，没有公式节点。
- 日期/时区/专家/模型筛选与伪造账号输入拒绝。
- Client维度切换、筛选、Excel导出、空态/服务错误、导航晚到和卸载清理。

仅编译本模块 Client，没有运行全产品构建/检查、启动图形应用或发起真实计费模型请求。最终产品装配/Windows验收由父智能体执行。CodeGraph 返回 autosync disabled 提示后使用了实际源码核对；未更改索引。
