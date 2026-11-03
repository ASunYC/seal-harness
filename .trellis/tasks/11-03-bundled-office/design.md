# 已核实的设计边界与阻塞

现有 product bundle 能通过 cordis.patch.yml 插入 Office 的 univer 行，无须修改只读内核。产品 build.mjs 已有运行依赖装配机制；electron-builder.mjs 与 verify-package.mjs 是打包及产物验证入口。计划在产品层固定依赖，保留 Office 的 worker、viewer、gateway、平台原生依赖与完整来源/许可；禁用默认匿名遥测。不能从用户 profile 复制运行时到安装包。

## 实际许可阻塞（尚未解决）
本机 Office 0.3.9 的 lib/build-info.json 记录构建 commit c59332186fbd0051596b6ef5d73b8322204ad1d5。该 commit 的 src/workers/unit-content/license.ts 明确将内嵌许可描述为 Application-owned，注明于 2027-01-09T16:00:00Z 到期。

实际本机包的 lib/index.js、artifacts/worker-chunks/chunk-PWYAH7S6.mjs、artifacts/render-machine/assets/index-bamWq0NN.js、artifacts/viewer/assets/index-CX0SVxB7.js 含该许可标识/到期值；不在文档复制许可正文。外部依赖包括 @univerjs-pro/exchange-node-binding 1.0.4、engine-formula-rust-binding 1.0.3，其本机包未附独立许可说明。

插件自身 Apache-2.0 不足以单独证明上游应用专用 Pro 许可可换品牌分发。官方 SDK 文档将 Pro 与开源能力分开，许可证覆盖功能/域名等限制。尚无此两个品牌的再分发授权或续期安排证据。这里不判定必然禁止分发；需要权利方现有条款/授权澄清，不能替用户签新协议、购买或获取持久凭据。

证据：
- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/src/workers/unit-content/license.ts
- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/LICENSE
- https://github.com/dream-num/univer#-open-source-and-pro
- https://docs.univer.ai/server/license （当前文档 v1.3.1；不能替代 0.3.9 依赖的具体授权）

因此暂停包含该 Office 运行时的分发包制作；未绕过/删除许可检查，未更换或输出许可正文。

## 本阶段实现边界
新增 seal-harness-desktop/scripts/office-bundle.mjs 与合成回归，在现有 desktop.mjs 分发分支调用，通过 electron-builder.mjs 白名单带入已装配的品牌 manifest/patch/NOTICE 和 Office payload，通过 verify-package.mjs 拒绝缺失运行时。真实依赖及授权待定，不在根依赖中偷偷引入 Pro。当前源工程不含复制的第三方 Office 包或许可。
