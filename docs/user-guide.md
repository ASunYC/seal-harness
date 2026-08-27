# 用户指南

## 选择入口

- `seal-harness run` / `seal-harness headless`：面向终端的一次或多轮 Headless Agent；
- `seal-harness web`：本地 WebUI、流式任务和浏览器审批；
- `seal-harness-rpc`：stdout 严格 JSONL 的应用集成入口。
- `@seal-harness/host`：在自己的 TypeScript 应用中启动 Profile。

## 下载发行包

GitHub Release 提供内置 Node.js 与生产依赖的 Windows、Linux 和 macOS 压缩包。解压后
无需安装 Node、npm 或 pnpm：

```text
# Windows
双击 Start Seal Harness.cmd

# Windows 终端方式（继续保留）
seal-harness.cmd web

# Linux / macOS
./seal-harness web
```

发行页同时提供 `SHA256SUMS.txt`。源码安装和 npm 包用于插件开发，自包含压缩包面向
直接使用。

Windows 双击启动器会保留一个状态窗口，关闭该窗口即可停止 Seal Harness。它只是调用
同目录中的 `seal-harness.cmd web`，不会替换或移除原有 CLI 使用方式。

## Provider 与模型

默认 CLI 支持按需加载 Anthropic、DeepSeek、Google、Groq、Mistral、OpenAI、
OpenRouter 和 xAI。API key 使用 `<PROVIDER>_API_KEY` 环境变量，或通过自定义
CredentialService 提供。

```sh
seal-harness --provider deepseek --model deepseek-chat "分析项目"
seal-harness --provider anthropic --model claude-sonnet-4-6 --reasoning high "修复测试"
```

使用 `--list-models` 查看 Profile 中的模型。自定义 Provider 应使用 `--config`。

## 附件

`--attach` 可重复使用。文件先进入内容寻址 Blob Store，Session 只保存引用；文本和
图片在模型请求前解析。附件内容会发送给所选 Provider。

```sh
seal-harness --attach ./trace.txt --attach ./screen.png "定位问题"
```

## Session

默认 Session 根目录是 `.seal-harness/sessions`。

```sh
# 继续 Session
seal-harness --session session-id "继续处理"

# 从指定事件版本 Fork 后继续
seal-harness --fork session-id --fork-version 20 "尝试另一种方案"
```

Session 包含提示、回答、工具参数和结果，应按敏感业务数据保护。

## 权限

- 默认 `workspace-write`：工作区内文件操作允许，外部/危险能力询问。
- `--no-shell`：完全不向模型暴露 Shell。
- `--deny-approvals`：所有 `ask` 失败关闭。
- `--yes`：自动批准，只适用于隔离环境。

非 TTY 环境的交互审批默认拒绝。

## WebUI

```sh
seal-harness web
seal-harness web --port 8080 --no-open
```

Web Host 默认只监听 `127.0.0.1:3080`。它提供工作区选择、模型选择、Session 列表与
恢复、流式回答、工具调用卡片、任务中止和浏览器审批。API key 可在 Connection 面板
设置，只保存在当前进程内存，服务停止即清除。

绑定非回环地址必须显式声明：

```sh
seal-harness web --host 0.0.0.0 --allow-remote --no-open
```

当前 Web Host 没有用户认证。远程监听只能放在可信网络或带认证的反向代理之后；
默认本机模式不需要 `--allow-remote`。

## 自定义 Profile

Profile 是原生 ESM，默认导出插件实例数组：

```sh
seal-harness --config ./seal-harness.config.mjs --provider my-provider --model my-model "hello"
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
