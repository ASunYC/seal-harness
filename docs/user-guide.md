# 用户指南

## 选择入口

- `seal-harness run` / `seal-harness headless`：面向终端的一次或多轮 Headless Agent；
- `seal-harness web`：本地 WebUI、流式任务和浏览器审批；
- `seal-harness acp`：供编辑器和自动化客户端使用的标准 ACP stdio Server；
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

WebUI 提供标准 Web App Manifest 和同源 Service Worker，可从支持的浏览器安装为独立窗口。
设置的“语言”选项支持 English 和简体中文，选择结果保存在当前浏览器中，并在后续访问时
自动恢复。首次访问会根据浏览器语言选择中文或英文。
Service Worker 只缓存静态应用外壳，不截获或缓存 `/api/` 请求；离线状态仅保证界面可启动，
Agent、Session 与设置仍需本机 Web Host 在线。

Assistant 消息按本地 Markdown 渲染，支持标题、强调、列表、引用、代码块、表格、链接与图片。
原始 HTML 始终转义，危险链接协议会被拒绝；流式输出会随着文本增量重新形成完整结构。
`$…$`、`\\(…\\)` 行内公式和 `$$…$$` 块公式由随应用安装的 KaTeX 渲染，不请求外部 CDN。
带语言标记的 fenced code block 由本地 highlight.js 高亮；未知或缺失语言安全回退为转义纯文本。
悬停代码块可复制原始代码；每条消息也提供整段复制，用户消息还可一键重新填入 Composer。

侧栏按持久工作区分组 Session。“Add workspace”注册一个已存在的本地目录；点击工作区名称会
以该目录开始新 Session。工作区可重命名或从侧栏移除，移除操作不会删除目录、文件或历史
Session，未归属的历史会显示在 Ungrouped 分组。
工作区悬停操作可调整顺序；隐藏的 Session 集中显示在可折叠 Hidden 分组，并可随时恢复。
Session 的悬停操作还可重命名；名称保存在 Session 事件历史中，并随重启和 fork 保留。

Composer 的 Attach 按钮与拖放入口仅接纳 PNG、JPG、WebP、GIF 图片；每条消息最多 20 张、单张不超过 20 MiB 且图片总计不超过 200 MiB，发送前可从缩略图轨中移除。
附件以内容哈希引用写入 Session，图片在对话中预览，其他文件显示为下载卡片。
运行中的 Steering 与 Follow-up 同样可携带附件或纯图片。尚未收到 Run `started` 的提交若失败，
Composer 会恢复原文本和附件；握手期间新加入的附件不会被上一笔提交清除。

```sh
seal-harness web
seal-harness web --port 8080 --no-open
```

Web Host 默认只监听 `127.0.0.1:3080`。它提供工作区选择、模型选择、Session 列表与
恢复、流式回答、工具调用卡片、任务中止和浏览器审批。长 Session 默认加载最新 200 条
逻辑消息并可向前翻页；压缩或显式替换掉的消息不会重新出现在界面中。Session Store 的
提交会通过实时事件更新会话目录和当前投影。侧栏底部 Settings 打开统一设置
中心：General 管理工作区、主题和安全说明；Models 从当前 Profile 的模型目录动态列出
Provider，管理模型、推理等级与本机凭据，并显示模型容量和能力；首次使用 DeepSeek 且
缺少可写凭据时会出现引导框；Plugins 显示
隔离 Profile 的安装清单、兼容状态和缺失适配器，并支持安装、启停与删除。插件变化会增量
重配置 Host 后缀并同步装卸 Client 作用域，无需重启 WebUI。浏览器会分别
记住每个 Provider 最近选择的模型。插件写操作只允许回环 Web Host。内置 Provider 的
API key 写入工作区 `.seal-harness/credentials.json`，不会写入 Session；启动环境提供的
密钥保持只读。动态发现的自定义 Provider 密钥仍只保存在当前进程。

打开已有 Session 后，右侧活动栏会聚合 Goal、Plan、Todo、Jobs、Subagents 与 Terminals。
其中运行中的 Job、子 Agent 和 Terminal 可直接取消或中止；服务端仍按当前 Session 校验
所有权，不能借助浏览器端 ID 操作其他 Session 的资源。

Models 页面还可以新增自定义 Provider。填写稳定的 Provider ID、`http(s)` Base URL、
协议（OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages）以及可选 API
key 后，Web Host 请求 `<baseUrl>/models`，兼容 OpenAI `data` 数组及 `models` 数组/对象
目录格式。探测成功的模型会立即进入选择器，无需重启；自定义 Provider 与凭据均只存在于
当前进程，若需跨重启保存，应在原生 Profile 的 `piAiProviderPlugin.customProviders` 中配置。

绑定非回环地址必须显式声明：

```sh
seal-harness web --host 0.0.0.0 --allow-remote --no-open
```

CLI 输出的启动 URL 含一次性 token；首次打开后会重定向到无 token 的 `/`，并设置
`HttpOnly; SameSite=Strict` Cookie。Cookie 授权可跨 Host 重启继续使用。远程监听仍须放在
可信网络、SSH 转发或提供 TLS 的反向代理之后；默认本机模式不需要 `--allow-remote`。

## ACP

```sh
seal-harness acp --cwd /absolute/workspace --provider deepseek --model deepseek-chat
```

ACP 入口使用官方 `@agentclientprotocol/sdk` 的 NDJSON stdio 传输，支持协议协商、
`session/new`、`session/prompt`、`session/cancel`、`session/list`、`session/resume` 和
`session/close`。文本、思考、工具开始/进度/结果会转换为标准 `session/update`；需要审批的
工具通过 `session/request_permission` 向客户端请求一次性允许或拒绝。当前不接受
`additionalDirectories` 或每 Session 动态 MCP 配置，调用时会返回明确的 invalid params。

## 自定义 Profile

Profile 是原生 ESM，默认导出插件实例数组：

```sh
seal-harness --config ./seal-harness.config.mjs --provider my-provider --model my-model "hello"
```

可从默认组合中移除 Tools、Telemetry、Compaction 等能力，也可替换 Runtime 和
Session Store。插件写法见 [`plugin-development.md`](plugin-development.md)。

需要加载 DeepSeek Harness/Cordis 插件时，使用与 DSH 相近的命令：

```sh
seal-harness plugin --profile web add 'github:user/repo#path:/plugin'
seal-harness plugin --profile web list
seal-harness plugin --profile web doctor
seal-harness plugin --profile web remove '@scope/plugin'
```

第三方包安装在 `~/.seal-harness/profiles/web`，不进入默认应用包。添加或删除 Host 插件后
重启 WebUI；皮肤切换可以在侧栏 Themes 中即时完成。支持矩阵和安全边界见
[`dsh-compatibility.md`](dsh-compatibility.md)。

插件可以携带源码构建脚本，但 pnpm 10 默认不会执行未批准的依赖脚本。安装输出若报告
被阻止的构建，应核对包来源后，把报告的准确包名加入该 Profile 的
`pnpm-workspace.yaml` 中的 `allowBuilds`，再重新执行 `plugin add`；不要使用全局脚本放行。

## RPC

每行一个请求，每行一个响应或事件 notification：

```json
{"id":1,"method":"listModels"}
{"id":2,"method":"prompt","params":{"cwd":"/repo","provider":"deepseek","model":"deepseek-chat","prompt":"inspect"}}
{"id":3,"method":"shutdown"}
```

支持方法：`prompt`、`listModels`、`listSessions`、`fork`、`shutdown`。
