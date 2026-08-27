# Seal Harness 架构

## 1. 目标

Seal Harness 使用 Pi Agent，但不把 Pi Coding Agent CLI 作为不可替换的宿主。
Pi 负责默认 Agent loop、流式消息和工具调用；Seal Harness 负责能力组合、生命周期、
安全边界和产品入口。

核心原则是“能力皆插件”，不是“每个函数都是插件”。插件的粒度对应一个可独立
替换、测试和部署的能力边界。

## 2. 分层

```text
apps/cli
  -> profile
     -> runtime-pi
     -> provider-pi-ai
     -> session-jsonl
     -> workspace-tools
     -> permission-basic
     -> context-files
        -> kernel
```

依赖方向只能指向下层。`kernel` 不得导入 Pi、模型 SDK、文件系统工具或 UI。

## 3. 微内核职责

微内核只负责：

1. 类型化服务令牌及服务注册表；
2. 根据 `requires`、`optional`、`provides` 构建稳定的插件启动拓扑；
3. 顺序、可等待的类型化事件；
4. 插件作用域内的副作用登记和自动清理；
5. 启动失败时回滚，正常停止时逆序卸载。

微内核明确不负责：

- Agent loop；
- LLM Provider；
- Session 持久化；
- Tool registry 或具体工具；
- 权限判断、审批或沙箱；
- System prompt、Skills、MCP；
- CLI、TUI、Web 或 RPC。

## 4. 插件模型

插件定义静态声明它提供、依赖和可选依赖的服务。Profile 中的每一行是一个插件
实例，拥有稳定且唯一的实例 ID。

插件通过作用域 Context：

- `provide()` 发布声明过的服务；
- `use()` 获取必需服务；
- `on()` 和 `emit()` 订阅或发送顺序事件；
- `effect()` 登记必须在卸载时执行的清理函数；
- `signal` 接收宿主停止通知。

启动完成前，内核校验插件是否确实发布了所有声明的服务。插件加载失败时，当前
插件的作用域副作用和此前已经启动的插件都会被清理。

## 5. 默认能力边界

| 能力 | 默认插件 | 可替换实现示例 |
|---|---|---|
| Agent runtime | `runtime-pi` | 测试 runtime、自定义 loop |
| LLM | `provider-pi-ai` | OpenAI-compatible、离线 mock |
| Session | `session-jsonl` | memory、SQLite、远端数据库 |
| Tool registry | `tools-core` | 测试 registry |
| Workspace tools | `workspace-tools` | 远端工作区、只读工具 |
| Policy | `permission-basic` | 企业策略、全拒绝策略 |
| Context | `context-files` | 数据库检索、远端知识库 |
| Entry point | `cli-headless` / `web` | RPC、未来可选 TUI |

## 6. 安全模型

插件是拥有 Node.js 进程权限的代码，安装即信任代码来源。模型可调用的有副作用
能力必须经过独立的 Policy 服务；Tool 插件不能自行绕开 Policy。进程级文件、
网络和命令隔离由可选 Sandbox 插件或部署容器实现。

默认 Profile 的目标是 `workspace-write + ask`：工作区外写入和高风险命令必须
拒绝或请求审批。任何 API key 都只能由 Credential 服务按请求解析，不进入
Session log、事件载荷或普通配置文件。

## 7. 稳定性边界

Pi API 只能在 `runtime-pi` 和 `provider-pi-ai` 内出现。其他插件依赖 Seal Harness
定义的窄接口。上游 Pi 使用精确版本，并通过以下契约测试升级：

- 流式文本事件顺序；
- 单次及并行工具调用；
- 工具失败和中止；
- Steering 与 Follow-up；
- Provider 错误与上下文溢出；
- Session 事件可重放性。

## 8. 非目标

- 第一版不实现插件热更新；
- 第一版不提供插件市场；
- 第一版不追求与 Pi Coding Agent Session 格式兼容；
- 第一版不把全部 Provider、UI 和高级工具塞入默认安装。

WebUI 是独立 `apps/web` 宿主，通过公共 Agent、Session 和 Model 服务工作；微内核和
能力插件不依赖浏览器代码。`apps/launcher` 只负责选择 Headless 或 Web runner。

## 9. DSH 兼容层

`@seal-harness/dsh-compat` 不改变微内核契约；只有 Profile 实际安装了 DSH 插件时才创建
Cordis Context。Web 产品携带轻量兼容运行时以保证开箱可安装，但第三方插件、主题素材和
插件专有依赖只进入用户的隔离 Profile，不进入默认应用依赖闭包。

`@seal-harness/plugin-manager` 只负责安装与发现，不把第三方插件编译进产品。每个 Profile
拥有独立的 `package.json`、lockfile、`node_modules` 和 DSH patch。GitHub `#path:` 依赖
使用 partial clone，只 checkout 包的运行时文件。Web Host 按 Profile 启动 Cordis Host
插件，并从同源 `/plugins/.../client.js` 提供浏览器 Bundle。
