# Ask Jev 双模型 DSH 插件

`packages/dsh-plugin-ask-jev/` 是独立 DSH bundle，Seal Harness 产品组合装配同一份 Host/Client。普通 DSH 可以从源码构建、`npm pack` 成 `.tgz`，再在活动 Profile 中用 `dsh plugin add <tgz>` 安装。安装后重启 DSH；详情见包内 [README](../../packages/dsh-plugin-ask-jev/README.md)。

| 提供方 | 模型 | 请求地址 |
| --- | --- | --- |
| TypeSafe Jev | `jev-latest` | `https://api.typesafe.ai/v1/systemone` |
| 阿里百炼 | `decision-model-preview` | `https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1/systemone` |

协议依据：[TypeSafe System One API](https://docs.typesafe.ai/api)、[阿里百炼决策 API](https://help.aliyun.com/zh/model-studio/decision-model-api)。阿里当前决策接口支持华北2（北京）和新加坡业务空间。两者都以 `state + questions` 发送 `noul`、`choice` 或 `score`，返回结构化答案而非解释性文字。

插件用 Host credentials 保存两家密钥并按 Seal Harness 本地账号隔离；Client 只得到配置状态。端点由提供方、地域及受限的 WorkspaceId 组成，不接受浏览器自定义任意 URL。真实模型调用失败会显示错误，没有静默切到模拟引擎。插件只借鉴 ask-jev 的决策流程，界面与源码独立实现；[ask-jev 来源](https://github.com/kuhung/ask-jev)。

无真实 API Key 时可验证包构建、DSH Profile 安装/启动、Seal Harness 装配、RPC、协议映射和 UI 行为；不能把这些结果当作真实远端模型可用性验证。
