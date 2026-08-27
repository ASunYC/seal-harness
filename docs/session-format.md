# Session 格式与恢复

## 逻辑模型

Session 是只追加的事件流。`version` 等于已提交事件数量，`append()` 使用
`expectedVersion` 做乐观并发控制。

主要事件：

- `session.created` / `session.forked`
- `run.started` / `run.completed`
- `turn.started` / `turn.completed`
- `message.appended`
- `tool.started` / `tool.completed`
- `context.compacted`

模型历史只从 Session 事件推导。Compaction 不删除旧事件；重放遇到
`context.compacted` 时，以摘要消息加指定数量的最近消息替换当前上下文视图。

## JSONL 物理格式

每个 Session 对应一个 base64url 文件名的 `.jsonl` 文件。每一物理行是一个完整
append 事务，而不是一个事件：

```json
{
  "formatVersion": 1,
  "sessionId": "session-id",
  "startSequence": 4,
  "records": [
    { "timestamp": "2026-08-25T00:00:00.000Z", "event": { "type": "...", "payload": {} } }
  ]
}
```

一次多事件 append 只写一行并 `fsync`。若进程留下损坏的最后一行，读取器丢弃
整行事务；中间损坏、Session ID 不匹配或 Sequence 不连续则失败，不静默跳过。

Fork 先写入临时文件并 `fsync`，再用同文件系统 hard link 原子发布目标文件。
目标已存在时失败，不覆盖。

## 运行时持久化屏障

`AgentRun.subscribe()` 是可等待的顺序订阅接口。Pi runtime 在继续下一阶段之前等待
订阅者。Agent 编排器据此保证：

1. Assistant tool-call 消息先提交；
2. 再提交 `tool.started`；
3. 工具执行结束后把 `tool.completed` 和 ToolResult 放在同一事务；
4. 然后 Pi 才能发起下一次模型请求。

UI 使用 `AsyncIterable`，不承担持久化职责；即使没有 UI 消费事件，屏障仍执行。

## 崩溃恢复

下次 prompt 打开 Session 时查找没有 `run.completed` 的 Run：

- 未完成模型响应：旧 Run 标记失败，新 prompt 正常开始；
- `tool.started` 没有 `tool.completed`：写入失败 ToolResult，明确说明未自动重放；
- 已提交 `tool.completed`：其 ToolResult 在同一事务中，不会出现一半状态。

Seal Harness 不声称外部副作用“恰好一次”。安全保证是恢复时不会静默重放可能已执行的
工具。
