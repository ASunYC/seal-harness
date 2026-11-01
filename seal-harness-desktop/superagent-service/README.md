# Seal Harness Superagent 服务

该服务使用 DeepSeek 官方研究原型 [`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype) 的固定提交 `6337fc823ce20251c8de8085948165c81aaa701e`，以独立 DSH Web Profile 运行。Seal 主进程仍使用原有 DSH 内核和会话数据。

在本目录运行 `docker compose up -d --build`。面板仅发布到本机 `http://127.0.0.1:3082/`，数据保存在 `superagent-home` 和 `superagent-work` Docker 卷中。首次访问需运行 `docker logs seal-superagent`，打开其中带 `?token=` 的本机登录链接；不要将该链接发送给他人。通过 `docker compose logs -f` 查看后续配置问题。

首次启动后，需要一个对 `ASunYC/seal-harness` 有写入权限的**专用 GitHub 账号**。由账号所有者在终端运行 `docker compose exec superagent gh-agent auth login`，再用 `docker compose exec superagent gh-agent api user --jq .login` 验证。不要把令牌写入聊天或仓库。然后在 Superagent 面板的 Sources 填 `ASunYC/seal-harness` 与 `/usr/local/bin/gh-agent`；在 Eval 中只允许自己的 GitHub 账号，先保留 `observe` 模式；在 Execution 中配置工作目录和准备命令。还需在独立 DSH Profile 中配置模型供应商。具体步骤以原型 [部署文档](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) 为准。

原型要求 POSIX 工具并会修改所在进程的环境，因此服务运行在容器中。它仍是研究原型，处理真实仓库请求前应先检查其权限和策略。
