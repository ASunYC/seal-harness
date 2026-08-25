# 用户指南

## 选择入口

- `piharness`：面向终端的一次或多轮 Headless Agent。
- `piharness-rpc`：stdout 严格 JSONL 的应用集成入口。
- `@piharness/host`：在自己的 TypeScript 应用中启动 Profile。

## Provider 与模型

默认 CLI 支持按需加载 Anthropic、DeepSeek、Google、Groq、Mistral、OpenAI、
OpenRouter 和 xAI。API key 使用 `<PROVIDER>_API_KEY` 环境变量，或通过自定义
CredentialService 提供。

```sh
piharness --provider deepseek --model deepseek-chat "分析项目"
piharness --provider anthropic --model claude-sonnet-4-6 --reasoning high "修复测试"
```

使用 `--list-models` 查看 Profile 中的模型。自定义 Provider 应使用 `--config`。

## 附件

`--attach` 可重复使用。文件先进入内容寻址 Blob Store，Session 只保存引用；文本和
图片在模型请求前解析。附件内容会发送给所选 Provider。

```sh
piharness --attach ./trace.txt --attach ./screen.png "定位问题"
```

## Session

默认 Session 根目录是 `.piharness/sessions`。

```sh
# 继续 Session
piharness --session session-id "继续处理"

# 从指定事件版本 Fork 后继续
piharness --fork session-id --fork-version 20 "尝试另一种方案"
```

Session 包含提示、回答、工具参数和结果，应按敏感业务数据保护。

## 权限

- 默认 `workspace-write`：工作区内文件操作允许，外部/危险能力询问。
- `--no-shell`：完全不向模型暴露 Shell。
- `--deny-approvals`：所有 `ask` 失败关闭。
- `--yes`：自动批准，只适用于隔离环境。

非 TTY 环境的交互审批默认拒绝。

## 自定义 Profile

Profile 是原生 ESM，默认导出插件实例数组：

```sh
piharness --config ./piharness.config.mjs --provider my-provider --model my-model "hello"
```

可从默认组合中移除 Tools、Telemetry、Compaction 等能力，也可替换 Runtime 和
Session Store。插件写法见 [`plugin-development.md`](plugin-development.md)。

## RPC

每行一个请求，每行一个响应或事件 notification：

```json
{"id":1,"method":"listModels"}
{"id":2,"method":"prompt","params":{"cwd":"/repo","provider":"deepseek","model":"deepseek-chat","prompt":"inspect"}}
{"id":3,"method":"shutdown"}
```

支持方法：`prompt`、`listModels`、`listSessions`、`fork`、`shutdown`。
