# 设计与边界

`dsh-plugin-ask-jev` Host 的 `createDecisionService` 和既有 RPC 保持单一凭据/决策数据源，另以公开 DSH tools 注册决策工具。Client 通过公开 `settings.section` slot 放置配置卡，复用原 status/configure RPC。Seal Harness 导航存在时，决策一级入口只作为原生会话的启动器；普通 DSH 保留既有 DecisionPanel。对话使用 DSH Session/Workspace 服务创建并打开，用户直接在原生输入框连续对话。Client 运行期记住该会话 ID，导航窄栏在其显示期间保持决策高亮，其他会话与首页仍按原规则运作。

决策接口只返回结构化值，不承诺直接生成自然语言；自然语言由当前配置的普通会话模型处理。无 API Key、模型调用失败或用户切换账号时工具明确报错。产品导航代码留在 `seal-harness-desktop/plugins/navigation/`，独立插件仍保持不依赖该私有服务。
