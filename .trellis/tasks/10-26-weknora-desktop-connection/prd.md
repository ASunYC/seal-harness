# WeKnora 插件在 Seal 内配置连接

## Goal

在 Seal 中保存 WeKnora 连接并让上游检索工具使用，保留原生模型设置入口

## Requirements

- 保留已引入的 `@wxg-prc-cpg/dsh-weknora@0.1.0` 上游工具源码与来源校验，在 Seal 本地插件中补上可用的连接配置。
- Seal 设置可保存 WeKnora API 地址与 API Key；密钥只进入 Host 凭据存储，不回传到 Client，也不写入仓库。保留打开 WeKnora 原生模型配置页的入口。
- 已注册的检索工具在保存或替换连接配置后使用最新凭据，无需重启；未配置密钥时给出可操作错误。
- WeKnora 管理员确认后可创建仅含检索与对话权限的专用 API Key，并保存到 Seal 本机凭据存储；自动测试使用假凭据，不耗用模型额度。

## Acceptance Criteria

- [x] Seal 设置中可查看连接状态、保存/清除凭据并测试只读连接，Client 不接收密钥。
- [x] 四个上游工具在凭据变化后读取新连接；检索的本地回归测试通过。
- [x] 产品构建与检查通过，真实 WeKnora 服务端在凭据录入前显示待连接，录入后可只读列出知识库（当前 0 个）。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
