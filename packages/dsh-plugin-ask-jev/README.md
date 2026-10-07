# 问问决策：DSH 插件

这是独立的 DSH Host/Client 插件，可在普通 DSH Desktop、`dsh web` 及 Seal Harness 中使用。决策交互参考 [ask-jev](https://github.com/kuhung/ask-jev) 的三种问题模式；本包的源码、界面和文案为独立实现，没有复制 ask-jev 的资源。

## 模型

| 提供方 | 模型 | API |
| --- | --- | --- |
| TypeSafe | `jev-latest` | `https://api.typesafe.ai/v1/systemone` |
| 阿里云百炼 | `decision-model-preview` | `{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1/systemone` |

阿里云目前支持华北2（北京）与新加坡两个决策模型地域；WorkspaceId 与 API Key 必须属于同一地域。接口均使用 TypeSafe System One 协议的 `state + questions`，分别支持是非判断 `noul`、候选选择 `choice` 和有序评分 `score`。模型只返回结构化决策，不生成解释文字。插件展示的简短结果句由本地格式化，概率和置信度来自模型。

## 构建和安装

从本仓库根目录使用 Node `^22.19.0 || >=24` 与 Yarn `4.18.0`：

```sh
node packages/dsh-plugin-ask-jev/scripts/build.mjs
npm pack ./packages/dsh-plugin-ask-jev
```

在普通 DSH 的活动 Profile 中使用官方插件命令安装生成的 `dsh-plugin-ask-jev-0.1.0.tgz`，然后重启 Desktop；插件包的 `dsh.bundle.patch` 会注册 Host 和 Client。Seal Harness 的产品构建会自动构建并装配同一包。不要把生成的 `lib/`、`node_modules/` 或 API Key 加入 Git。

打开“问问决策”后选择提供方，配置 API Key；使用阿里百炼时再填地域和 WorkspaceId。Key 通过 DSH Host 的 credentials 服务保存，状态查询只返回是否已配置，不返回密钥。若本机没有凭据服务，插件无法激活。两家提供方的凭据独立保存；Seal Harness 本地账号之间也按账号隔离。

没有密钥或远端失败时会显示错误，不会把模拟结果标成 Jev 或阿里返回值。本包不包含 ask-jev 的本地 mock。真实调用需要可用的服务权限、网络和对应 API Key。

协议参考：[TypeSafe System One API](https://docs.typesafe.ai/api)、[阿里云百炼决策模型 API](https://help.aliyun.com/zh/model-studio/decision-model-api)。
