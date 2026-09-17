# PI 会话 SDK 迁移

## 目标与边界

使用原版 `@earendil-works/pi-coding-agent`，通过公开 SDK 承接执行和会话基础能力。
不修改 PI 包、不访问内部队列、不引入 DSH Agent Loop。不以切换依赖代替实际迁移。
保留 Seal 的界面、桌面壳、工作区、权限与产品品牌；暂停无关功能扩展。

## 验收顺序

- [x] 固定与当前内核一致的 0.84.3，验证真实 SDK 的新会话、流式事件、工具、停止、恢复、压缩。
- [ ] 确定 PI 会话数据与 Seal 产品元数据的唯一写入者；旧数据保留，先兼容读取/显式导入，不覆盖原文件。
- [ ] 将 runtime-pi / agent-core 的主执行入口迁移到 AgentSession。
- [ ] 排队、编辑、取消只通过公开 API 实现；验证图片与消息标识不丢失。
- [ ] 将上下文压缩与会话恢复交由 PI，清除默认链路的重复控制。
- [ ] 对 DSH 兼容层逐项分类：工具/展示可保留；执行政策不得绕开 PI 会话 SDK。
- [ ] 回归 Web / CLI、子会话、权限、历史记录及桌面构建。
- [ ] 审查是否仍存在内部访问、未使用的旧实现和迁移遗留；记录确切结果与限制。

## 当前阶段

默认运行类已切换到 AgentSession，但会话持久化与 DSH 钩子迁移仍未完成，不能声称迁移完成。
迁移期间保留既有改动；用户于 2026-09-17 明确要求修复检查后提交并同步当前分支。
本次同步仅保存阶段性成果，不代表迁移验收完成；不创建标签、发布或提升版本号。

`plugins/runtime-pi/test/coding-session.test.ts` 的 7 项测试通过：新会话流式文本、
自定义工具与后续执行、运行中停止、JSONL 恢复及追加不改写历史、手动压缩与恢复、
自动阈值压缩、公开 followUp 队列。使用真实 SDK，只有模型传输为测试实现，
未调用付费模型；文件、配置与凭据均隔离在测试创建的临时目录。

自动压缩沿用 PI 的触发与保留策略：仅有较高 usage 不一定能压缩，
仍须存在可被截断的历史边界。不要为迎合旧 Seal 行为修改 PI 此机制。

## 已实现的接入构件

- `plugins/runtime-pi/src/coding-session.ts`：真实 AgentSession 工厂；强制调用者提供
  sessionManager / settingsManager / resourceLoader / agentDir。经公开 provider API
  将模型 I/O 委托给现有 Seal ModelService，不复制凭据、不读写默认 ~/.pi，
  不实现另一个执行或重试循环。其认证状态仅表示进程内传输可用，
  不得当成供应商密钥已配置的 UI 状态；实际认证仍由 Seal 模型传输执行。
- `plugins/runtime-pi/src/session-import.ts`：只向空 PI 会话一次性导入已解析的 Seal 历史，
  保留用户消息 ID、来源与图片；记录导入开始、摘要校验标识、完成标识。
  重复导入不追加；残缺导入、会话归属冲突、未解析附件/助手图片均拒绝，
  不改写源 Seal 数据。调用者仍须落实跨进程独占会话写入。
- 以上构件已被默认 PiAgentRuntime 调用。旧版直接 new Agent / continue 的实现已移除，
  工具内容转换保留在 runtime-tools.ts，运行生命周期通过 SDK 扩展事件桥接。

## 当前已知过渡问题（不可发布）

- 默认 profile 已传入 dataHome，原生会话写在 dataHome/pi-sessions 下，
  文件名由 Seal session ID 的 SHA-256 派生。只有首次导入历史，之后只追加 inputMessages。
  未指定 dataHome 的直接 SDK 构造仍为 inMemory，主要用于隔离测试；自定义 profile 需显式配置。
  runtime 原生文件恢复与压缩跨轮保留已有集成测试，Seal UI 事件投影/删除/分叉仍待接入。
- session-storage.ts 在 Windows 使用命名管道、Linux 使用抽象 Unix socket 作为
  操作系统持有的跨进程互斥锁（不是网络服务，也不接收命令）。目录先 realpath，
  Windows 路径归一化，避免同目录别名绕过互斥。保留独占 lease 文件兼容旧进程。
  持有 OS 锁后，仅在旧文件的 PID 明确不存在时回收 lease，不改写 JSONL。
  活跃 PID、权限不明、损坏/空 lease 均保留并报错；其他平台仍采用保守文件锁。
  Windows 独立进程测试通过：拒绝活跃写者、强杀后恢复且历史字节不变、四方竞争
  只有一方成功、正常释放和异常初始化释放。Linux 分支尚未在 Linux 主机实测。
  极端情况下进程在写入 lease 元数据前退出，仍需人工检查空文件，不能无条件抢锁。
- 旧 runtimeHooks 的必要能力已映射到 PI 扩展：input 处理输入改写/拒绝，context
  处理实际请求选择，turn_end 处理结束前补充消息，message_end 通知请求错误。
  request-error 返回 retry 不再决定重试；由原生 SDK 判定、退避和继续执行。
  测试已改为验证“兼容代码不能强制重试”，另测原生 SDK 自动恢复 503。
- SDK input 在 turn_start 前执行，Seal 投影现可记录无模型轮次的输入改写/拒绝。
  多条前置上下文通过 SessionManager 公共 append API 持久化，再由 Agent 文档声明的
  state.messages setter 从原生会话重建上下文；不访问内部队列、不新增执行循环。
  SDK 扩展异常会中止请求并报告错误，防止 SDK 捕获扩展异常后绕过策略继续调用模型。
- DSH 单个综合测试文件 116 项全部通过（重建当前包后验证）；不等于 Web 全链路已通过。
  仍须验证同轮多次工具步骤的 preStep 上下文策略、动态模型切换与压缩配置一致性。
- 队列使用公开 clearQueue / steer / followUp 与 Seal 元数据映射，不再读取内部数组。
  停止时清空 SDK 待发队列但保留 Seal 待发记录，避免停止后 SDK 再消费队列。
  已补测 one-at-a-time / all 模式下多文本块与图片交错、同文 steering/followUp、
  消息 ID/来源、消费顺序与最终清空。匹配 SDK 标准化输入后恢复原始块，
  未解析附件在修改队列前拒绝。仍须验证批量消息已出队但尚未逐条发事件时的编辑竞态。
- PI runtime 声明 managesCompaction，agent-core 不再执行第二套宿主自动压缩；
  现通过 AgentSession.subscribe 转发原生 compaction_start/end 为 Seal compaction_activity，
  事件在现有持久化屏障上串行转发；Web 状态栏与折叠过程预览显示压缩状态，结束后恢复。
  PiRuntimeOptions.compaction 直接传给 SettingsManager，不另写触发/压缩策略。
  原生自动压缩的开启/关闭、开始结束顺序、完成后的继续执行及 JSONL 记录测试通过，
  对应 Web DOM 测试通过。摘要现经 context_compacted 桥接为 Seal context.compacted，
  核对被替换前缀后仅替换可见投影，原始事件保留；不匹配时拒绝替换并报错。
  原生摘要通过上游公开 convertToLlm 转换；完成结果标明消息已经逐条发出，
  防止把压缩后上下文误当作未持久化的新增消息重复写入。
  Web/CLI 原生压缩、摘要展示和后续轮次恢复已有端到端测试。产品设置映射、
  崩溃后跨存储投影补齐及复杂附件/分叉场景仍待完成。
- 2026-09-17 完整 pnpm check 通过：全仓类型检查、149 个测试文件（727 项通过、
  1 项跳过）、Python SDK 6 项、发布脚本 6 项。之前 3 项压缩回归失败已解决：
  Web/CLI 改为验证 PI 原生阈值压缩及摘要投影，旧启动压缩错误/取消测试使用
  非原生测试运行时继续覆盖宿主兼容路径，没有重新启用 PI 的重复宿主压缩。
  另补原生压缩失败/取消测试：失败保留原历史，取消后阻止后续模型请求及自动压缩；
  PI 的压缩异常事件若未标 aborted，Seal 根据自己的已取消信号正确显示取消状态。
- 后续持久化接入：native-runtime.test.ts 的 3 项真实运行测试通过，分别验证
  新 runtime 实例恢复且忽略旧投影、并发写入拒绝、真实 SDK 压缩后跨实例恢复。
  native-runtime + agent-core 合计 17 项通过；运行包类型检查通过。

## 下一步接入责任

PI JSONL 将是迁移后模型上下文与压缩记录的权威来源；Seal 事件存储保留工作区、
权限、附件、队列标识与 UI 投影。禁止每轮拿 Seal 历史重新覆盖原生会话。
首次运行在独占会话租约下导入旧历史，之后只提交本轮新增输入；
进程恢复从 PI 原生会话读取，Seal 投影通过事件关联补齐，不能反向重新调度执行。
路径配置、基本租约、新增输入切分已接入；仍须落实崩溃恢复、UI 事件/队列元数据桥接、
压缩配置/事件投影、DSH 钩子迁移、删除/分叉一致性及全链路回归。

## 必须解决的兼容点

1. 当前 Seal 会话事件不是 PI 原生 JSONL，不能直接当作 PI 会话打开。
2. 当前运行适配器读取、修改 PI 内部 steeringQueue / followUpQueue，迁移必须去除。
3. Seal 消息含消息 ID、来源与附件引用，SDK 的字符串队列接口并不直接承载全部元数据。
4. 不能同时启用 Seal 与 PI 两套自动压缩和重试机制。
5. 凭据和配置应留在 Seal 用户目录，不能默认读写用户已有的 ~/.pi 配置。
