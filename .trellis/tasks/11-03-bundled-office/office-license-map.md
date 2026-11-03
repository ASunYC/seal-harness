# Office 0.3.9 实际调用与授权边界

核查日期：2026-11-03。用户确认未取得任何 Univer/Pro 单独授权。未购买、签约、联系销售、外发资料或重新分发真实许可。

## 版本与证据边界

本机 dsh-univer-office/package.json 为 0.3.9，lib/build-info.json 指向源码 c59332186fbd0051596b6ef5d73b8322204ad1d5；源码 manifest 将多数 Univer SDK/CLI 模块固定为 1.2.0，原生转换器为 exchange-node-binding 1.0.4，公式 native binding 为 1.0.3。下列源码链接全部固定该 commit，不以当前 main 代替实际版本。官方在线 SDK 文档目前标注 v1.3.1；其 Free 配额不能直接声称已在本机 1.2.0 复现。

## 功能映射

| 功能 | 该版本真实路径 | 授权判断与限制 |
| --- | --- | --- |
| 基础表格单元格/样式/普通公式，Doc 基础编辑，Slides 基础模型/UI | @univerjs/core、sheets、docs、engine-formula 等开源包存在；官方开源仓库覆盖这些基础能力 | 不应称全部 Office 都要付费。可在各自开源许可下用于商业产品。但本插件的实际组合同时加载 Pro 与应用许可，不能因为基础能力开源就把整包视作纯 OSS。 |
| XLSX/CSV/TSV、DOCX、PPTX 导入导出 | workers/unit-content/entry.ts 直接 import importFile/exportToFile from @univerjs-pro/exchange-node；分别使用 XLSX/CSV/TSV、DOCX、PPTX 格式。gateway-app/exchange/gateway-exchange-service.ts 的界面入口也直接调用 importBuffer/importBufferToSnapshot/exportSnapshotToBuffer | 确实是 Pro Exchange 转换路径，不是 openpyxl/python-docx/python-pptx 替代实现。当前官方文档有无需凭据的 Free 模式及导出限额；“有 Free”不等于可无条件离线 OEM 或换品牌再分发，也不能把当前文档配额当该版本实测。 |
| 图表、透视、迷你图、分组、历史，增强公式 | viewer-support/render-preset/index.ts 显式 import/register sheets-chart、sheets-pivot、sheets-sparkline、sheets-outline、engine-formula；同一组合还包含 Doc/Slide Pro 模块及历史支持 | 官方将这些增强能力区分于开源基础组件。当前插件真实启用，不能仅删一个 license 配置便声称保留全部功能且合法开源。普通公式与增强 Pro 引擎需区分。 |
| PNG 截图、布局 lint、SVG 排版、PDF | host/provider/render-operations.ts 经 @univer-cli/unit-screenshot、unit-pdf-printer、univer-render-runtime 打开 Chromium Render Machine，并传入应用许可；render-machine/main.ts 使用与 Viewer 相同 registerViewRendering，包含 Pro rendering/print 插件 | 这条路径不是调用 Exchange PDF binding，也不是只截一个无关网页。Chromium 截图/打印机制本身不应一概判为收费，但当前渲染内容依赖 Pro 组合和许可。若改为纯 OSS/其他引擎，需要另行实现和验收，版式可能变化。 |
| 实时 Viewer、草稿 worktree、Agent 编辑及协作/历史 | workers/unit-content/runtime/content-runtime.ts 使用 createStandardHeadlessUniverFactory({license: env || UNIVER_LICENSE}) 和 createUniverCollaborationRuntimeFactory；Gateway import @univerjs-pro/collaboration-service 与 UnitSnapshotMaterializer，Viewer 加载 collaboration-client-ui | 即使只有本机一个人使用，当前 Agent 草稿和编辑仍走协作运行时，不能简单关掉“多人协作”就认为没有 Pro 依赖。当前官方文档有 Free 单节点/连接限制，但实际版本、文档类型及再分发权仍需核实。 |

## 内嵌许可事实

固定 commit 的 workers/unit-content/license.ts 描述为 Application-owned。viewer-support/render-preset/license.ts 注明面向 localhost 与 DSH desktop (app)，标识 TEST_LICENSE。两处源码注释都写 2026-10-08T07:08:19Z 签发、2027-01-09T16:00:00Z 到期。此为源码记录的到期信息，不是本次发现日期，也不是用户购买凭据。

本机已安装产物的 lib/index.js、artifacts/worker-chunks/chunk-PWYAH7S6.mjs、render-machine/assets/index-bamWq0NN.js、viewer/assets/index-CX0SVxB7.js 包含相应许可标识/到期值（只检查匹配并记录文件名，没有复制许可正文）。当前仍在所记录有效期内，不应称“已过期”。有效期内运行也不足以证明许可覆盖 Seal Harness、AE-Hospital 的换品牌分发/客户离线安装。

插件源码 Apache-2.0 与内含商业 SDK 的许可是两层。当前官方 pricing 明确区分开源与商业组件，并说明示例开源许可不扩展覆盖商业依赖。协议 1.4、2.1、2.4 等条款需与权利方确认具体产品集成和授权范围。未找到明确授予两个下游品牌离线 OEM 再分发权的现有凭证。也没有依据断言必须买两份许可证：品牌数不是这里已核实的计费单位。

## 最小决策与可行方向

1. 若目标保留当前完整 Univer Office，先向权利方确认现有开源插件内嵌许可是否覆盖两个下游产品的商业/免费分发、客户离线部署、域名/app 协议、期限与续期。没有既有授权时，再由用户决定是否申请适用许可；本任务不代签、不购买、不发送询问。
2. 若用户希望完全免 Pro，可研究纯 OSS 基础编辑 + 独立文件处理/预览路线。会失去或需重新实现图表/透视/高级公式/协作/历史/现有高保真导入导出与打印，不能承诺等价。DSH 原办公技能及 LibreOffice Kit 是另一个候选，仍需按实际版本核实其分发许可和功能；没有自行替换产品目标。
3. Free SDK 模式可用于进一步受限验证研究；不能把在线新版本 Free 条款自动套到旧插件，也不能通过删除内嵌许可或绕过检查来当成可交付版。

## 官方来源

- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/src/workers/unit-content/entry.ts
- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/src/gateway-app/exchange/gateway-exchange-service.ts
- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/src/viewer-support/render-preset/index.ts
- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/src/host/provider/render-operations.ts
- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/src/workers/unit-content/runtime/content-runtime.ts
- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/src/workers/unit-content/license.ts
- https://github.com/dream-num/dsh-univer-office/blob/c59332186fbd0051596b6ef5d73b8322204ad1d5/src/viewer-support/render-preset/license.ts
- https://github.com/dream-num/univer#-open-source-and-pro
- https://docs.univer.ai/server/license
- https://docs.univer.ai/server/import-export/license
- https://docs.univer.ai/server/collaboration/license
- https://univer.ai/pricing/
- https://univer.ai/legal/license-agreement/
