# Seal 产品与执行边界

Seal 是独立产品，Pi Agent 是产品唯一的 Agent 执行内核。

- 默认 Web 页面使用 Seal 的品牌、会话界面和交互入口。
- 允许复用 DeepSeek Harness 依赖和兼容插件接口；这些服务通过 Seal AgentService 调用 Pi。
- 不提供 DSH Agent Loop、独立 Loop fallback 或启动 DSH CLI 的 SDK 子 Agent 适配器。
- `#dsh-shell` 仅是界面组件的显式预览，不改变执行内核。
- Seal 的默认会话头部提供 Team 面板，读取同一个原生 TeamService。

历史对齐记录中“官方壳默认启用”和“独立 Agent Loop fallback”的描述已经被上述边界取代。
依赖复用不代表允许替换 Seal 的执行权威。
