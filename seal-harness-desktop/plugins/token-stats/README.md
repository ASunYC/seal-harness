# Token 统计

`@seal-harness/token-stats` 是独立的 Seal Harness Host/Client 插件，一级入口为“Token 统计”。页面提供时间区间、IANA 时区、专家和模型筛选，以及汇总、每日、专家、模型维度和真实 `.xlsx` 导出；导出包含四张工作表，Excel 使用 OpenXML 数值和文本单元格，不把文本当公式。

## 统计范围

- 仅统计插件启用后、当前本机账号已登录时开始的轮次。`turn/start` 在共享 SQLite 绑定 `session_id + turn` 的账号，之后切换账号、退出或重启不会改变这笔归属。
- 使用公开 `sessionProjections` Host 投影和 `@deepseek-ai/dsh-token-meter/client` 的 `deriveTurnTokenUsage`。投影只保留生命周期、提供方用量与模型归因，不保存提示词、回复正文或工具内容，也不调用已弃用的同步历史读取接口。
- `turn/end` 记录可证明的准确总量；重试算入同一轮，最终结算重复到达不会重复累计。总量已经包含缓存；推理量属于输出子集。服务商未提供的缓存/推理字段显示“未提供”。
- 不导入无法安全判断账号归属的旧 Profile 历史，不估算辅助请求、缺失的 usage 或价格。未结算记录可能包含中断后未恢复的轮次，不能等同于仍在运行。多模型同轮保留合并归因，不能凭总量拆分各模型费用。

## Host 与持久化

依赖 `sealHarnessDatabase`、`sealHarnessIdentity`、`connection` 和 `sessionProjections`。`local-data` 的 v7 前向迁移拥有 `token_usage_turns`，DDL 对照在 `src/schema.js`；本插件不建库、不修改 PRAGMA。账号归属和用量保存在同一行，主键为 `(session_id, turn)`。

RPC 使用 `POST /api/seal-harness-token-stats/{snapshot,export}` 和标准 `client-request` / `server-response` envelope。请求字段为：

```json
{"from":"2026-10-01","to":"2026-10-31","timeZone":"Asia/Shanghai","view":"summary","expert":"","model":""}
```

`view` 为 `summary/day/expert/model`；日期按所选时区包含首尾，最长 367 天。`expert` 是原生 Agent preset ID，`model` 是返回的模型筛选 ID。只允许当前账号，不接受 `userId` 等身份覆盖字段。`snapshot` 返回汇总、分组、可选筛选项及统计缺口说明；`export` 返回 `{filename,mimeType,base64}`，内容是真实 `.xlsx`。未登录、无效日期/时区/字段、内部查询失败均返回明确错误，不返回其他账号的记录。

Client 通过 `ctx.inject(['sealHarnessNavigation'], ...)` 注册 `primary:true`、`order:100` 的页面。切换账号会重建页面并取消旧请求，卸载取消导出和注册；投影和事件订阅由 Cordis 生命周期释放。

## 验证

运行现有 Node 24：`node --test seal-harness-desktop/plugins/token-stats/tests/*.test.mjs`。测试覆盖真实 Cordis Session 事件到 RPC、插件卸载重载、缓存与重试、账号隔离及跨重启去重、历史范围、日期/时区筛选、四张 Excel 工作表结构及内容、UI 筛选/导出/空态/失败与晚到导航。未进行真实计费模型请求；统计维度参考 Octop Enterprise，代码为 Seal 独立实现。
