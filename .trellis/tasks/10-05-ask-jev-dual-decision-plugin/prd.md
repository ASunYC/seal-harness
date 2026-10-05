# Ask Jev 双模型 DSH 插件

## 目标

把 ask-jev 的三类决策交互做成可独立安装的 DSH Host/Client 插件，并随 Seal Harness 产品装配。用户可选择 TypeSafe Jev 或阿里百炼 `decision-model-preview`，填写各自凭据后执行真实结构化决策。

## 范围

- 独立插件包提供 DSH bundle、Host/Client 入口与可安装产物，不依赖 Seal Harness 专有服务。
- 三种模式：是非判断、候选选择、有序评分；可输入问题及背景，界面显示来源模型、结构化结果、概率/置信度和明确的错误。
- TypeSafe Jev 使用 `POST https://api.typesafe.ai/v1/systemone`、`model: jev-latest`；阿里模型使用业务空间专属的北京或新加坡 `POST /compatible-mode/v1/systemone`、`model: decision-model-preview`。
- API Key 仅保存在 DSH Host 凭据服务；客户端仅拿到是否已配置的状态。模型选择、地域与 WorkspaceId 可保存。前端不能指定任意 Host 请求地址。
- Seal Harness 将此插件装入产品 bundle，并在首页资源导航中可访问；普通 DSH 可通过独立 bundle 安装。
- 不直接复制未标注许可证的 ask-jev 源码、图像或特有文案。实现同类决策流程，保留来源链接与 TypeSafe/阿里 API attribution。
- 不做隐式本地模拟或伪装为真实模型的兜底；凭据缺失和远端错误直接显示。
- 保留仓库中其他任务已存在的未提交导航改动，不重置、不纳入本任务提交。

## 验收

- [x] 独立包可构建、打包并在 DSH Profile 作为 bundle 启动，Host/Client 均激活。
- [x] Seal Harness 装配入口经 Profile 与 Client 注册测试；独立 DSH Web 中实际打开界面，Seal Harness 原生窗口尚未手动点击验收。
- [x] 两个提供方的 endpoint、鉴权、请求和响应经夹具测试，用户可在界面切换，错误不被伪结果掩盖。
- [x] 密钥不会返回 Client、落入源文件或日志；配置可在 Host 重建后恢复。
- [x] 产品构建、定向测试、类型/布局检查通过；无真实密钥时明确记录未做线上联调。
