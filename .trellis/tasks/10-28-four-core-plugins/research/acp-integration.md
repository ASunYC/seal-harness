# ACP 接入预研与共享存储

- 当前 DSH 的 `@deepseek-ai/dsh-acp@0.2.1-rc.2` 是把 Harness 暴露成 ACP Agent 的服务端，不是管理外部 Runner 的客户端，不能直接装配它就宣称外部 Runner 可用。
- 固定子模块 `packages/subagent/subagent-acp/README.zh.md` 和 `src/run.ts` 展示真正外部客户端路径：`client`、`ndJsonStream`、`methods.agent.initialize`、`methods.agent.session.new`、`methods.agent.session.prompt`。该 package 只有 vendor tarball，当前 Beta node_modules 没装；不要深度导入上游内部 run.ts。
- Beta 已安装 `@agentclientprotocol/sdk@1.4.0`，公开 stable entry 支持 `client({name})`、`.requestPermission(...)`、`.sessionUpdate(...)`、`.connect(stream)`；连接的 `.agent.request(methods..., params)` 执行标准 ACP v1。无需增加第二套运行时或另一份锁文件。
- local-data v7 已由主智能体提供表 `acp_runners(user_id TEXT FK users, id TEXT, name TEXT, config_json TEXT, enabled INTEGER 0/1, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(user_id,id))`。配置 JSON 不保存秘密。模块不要重复建表或改 PRAGMA。
- 输入预设参考 Octop 的 OpenCode、CodeBuddy、Claude Code、Codex、Kimi Code、Cursor CLI、Pi，但要标明需要其 ACP 模式/adapter，不能把任意聊天 CLI 当 ACP。发现程序与真实握手分开；默认不自动下载安装、登录或发模型任务。
- Host 仅当前 local identity 读写与运行本账号 Runner；取消/退出/改配置时撤销旧运行。秘密如有配置需求用 credentials 独立账号 key，不回传旧值。进程不要继承所有 DSH/模型密钥；权限默认拒绝或显式一次授权。
- Client `navigation.register({id:'acp',label:'ACP',icon:'acp',order:130,primary:true,Panel})`，通过 ctx.inject 处理导航服务生命周期。
