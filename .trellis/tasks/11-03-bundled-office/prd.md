# 随包 Office 安装交付

## 授权与范围
Seal Harness 与 AE-Hospital 均需默认安装现有 DSH 0.2.1-rc.5 和 Univer Office 0.3.9。保留已有未提交升级与品牌修改、独立产品身份和 Home；不得复制用户 profile 或凭据。Seal 验证通过后允许合并并推送真实主分支；AE 只本地提交，远程目标另行确认。不发布 GitHub Release。

## 验收
- 从公开、固定版本和可追溯哈希的依赖构建，包含第三方许可证。
- Windows x64 安装产物支持隔离 Home 首次启动、重复启动、升级与数据保留。
- 实测 Sheet、Doc、Slide 的适用创建、读写、导入导出和预览路径。
- 产品与共享变体必需检查通过后分阶段提交，不将子模块 pin 与产品行为混合。

## 当前状态
产品层装配/打包验证机制及合成测试已实现，真实 Pro 依赖和安装产物仍因授权未确认而 pending。两品牌完整当前基线重跑通过；首次 Electron 超时未重现，未放宽门禁。详见 implement.md 和 office-license-map.md。未完成真实 Office 新装验收，不推送。
