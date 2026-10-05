# 执行顺序

1. 确认 DSH 独立 bundle、Host/Client 插件和凭据服务的公开契约；保留其他任务的未提交改动。
2. 建立可独立构建的 DSH 插件包及双提供方 API 适配层，编写网络与凭据夹具测试。
3. 完成用户界面、模型与模式切换、配置和结果展示；验证 React/Loader 生命周期。
4. 接入 Seal Harness 构建与 Profile，验证普通 DSH Profile 中的独立 bundle 启动。
5. 运行产品构建、检查与相关根门禁，记录缺少真实凭据的联调边界；仅提交本任务路径。

## 结果

- 七项插件定向测试通过；TypeSafe/阿里协议由夹具验证，密钥仅在 Host credentials 中保存。
- 普通 DSH 隔离 Web Profile 通过官方 `dsh plugin add` 安装 tarball，实际启动并在浏览器打开插件，切换到阿里配置页。
- Seal Harness `seal-harness:build` / `seal-harness:check`、根 `typecheck` / `check:layout`、`yarn install --immutable` 通过。
- Windows 解包中有完整插件文件；最终上游 packaged-runtime smoke 在 `dsh-fs-local` BigInt 计算报错，故安装包完整门禁未通过。
- 未提供真实 TypeSafe/百炼凭据，无法声称两家云端调用通过；没有删除或重置其他任务的导航改动。
