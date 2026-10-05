# 设计

## 依据

- [ask-jev 路由](https://github.com/kuhung/ask-jev/blob/main/app/api/jev/route.ts) 以 `/api/jev` 代理 TypeSafe System One，三种模式映射为 `noul`、`choice`、`score`；它的本地 mock 是演示逻辑，不作为真实 Jev 接入证明。
- [TypeSafe 官方 API](https://docs.typesafe.ai/api) 提供 `jev-latest` 与 `POST /v1/systemone`。
- [阿里百炼决策 API](https://help.aliyun.com/zh/model-studio/decision-model-api) 使用相同 typed questions 协议，模型为 `decision-model-preview`，端点含 WorkspaceId 和地域。

## 包与生命周期

在根 `packages/` 建立独立 `dsh-plugin-ask-jev` 包，但不改变根 Yarn workspaces 或锁文件。构建复用 Beta 已安装的 tsdown，输出 Host ESM、Client Loader bundle、`cordis.patch.yml`。Host 注入 DSH connection/credentials，Client 注入 slots/layout/connection。普通 DSH 注册独立主面板和侧栏项；Seal Harness 若存在 `sealHarnessNavigation`，注册到首页二级资源菜单。产品构建先构建此包，再复制安装产物并把插件加入产品 Cordis patch；不修改固定子模块。

## 数据流

Client 的配置、状态和执行动作通过产品专属 Connection RPC 调用 Host。Host 使用 DSH credentials 的 grant 记录保存各提供方 Key 与非敏感设置，返回状态时剔除 Key。决策请求固定为 `state` 加一个 `decision` 问题，提供方适配层只替换固定端点和模型名；一律服务端发 Bearer 凭据。响应校验 `answers.decision` 的类型、范围和候选约束，统一转成展示模型。失败返回显式错误；不调用本地 mock。

## 边界

Jev/阿里决策模型不生成自然语言解释。界面呈现原始概率、置信度与由插件明确标注的简短结果摘要。阿里 WorkspaceId 仅可作为合法主机标签，地域从封闭集合选择，不能由客户端传任意 URL。RPC 和远端请求设置大小、超时与取消边界。无密钥时可以打开插件和填写配置，但不伪报远端决策成功。
