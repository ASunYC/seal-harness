# 设置菜单布局审查（只读，2026-11-03）

## 范围和来源

先通过 CodeGraph 检查登记与组件关系，再读取未覆盖的注册/CSS。没有修改产品源码或运行构建。下列10项对应截图中的菜单；`account`为条件登记，不能在新壳内写死菜单数组。

| 菜单 / id | 登记位置 | 页面布局事实 | 全页适配建议 |
| --- | --- | --- | --- |
| 通用设置 / general | deepseek-harness/packages/client/ui-settings-general/src/client/index.ts，order0 | GeneralSection.module.css `.section` 已是width100%/flex-column，没有固定height或scroll | 保留所有settings.general.item，交给壳统一inset和scroll，无需再包一层固定高容器 |
| 模型 / models | ui-settings-models/src/client/index.ts，order10 | ModelsSection.module.css `.section` max-width720；标题16px；原生高级编辑grid两列minmax(0,1fr) | 外层section-id定向解除720上限或统一到共同可读宽度，标题按统一规则；窄内容区检查编辑器而不是仅按viewport断点 |
| 内置插件 / plugins | ui-settings-plugins/src/client/index.ts，order15 | PluginsSettingsSection.module.css `.section` max-width760；标题18px；面板min-width0；子tab访问后隐藏但保持挂载 | 保留settings.plugins.tab和hidden状态，避免用display规则强行显示已隐藏tab；仅root宽度对齐 |
| 问问决策 / ask-jev | packages/dsh-plugin-ask-jev/src/client.jsx，order15 | `.ask-jev-settings-page` 已heightauto/overflowvisible/backgroundtransparent/padding4px0 28；标题22px；表单两列，viewport650断为一列 | 不套主决策页`.ask-jev-content`1040px居中规则；设置页root标题/inset统一。窄内容区宜将`.ask-jev-settings-form`设一列 |
| Agent预设 / agent-presets | ui-agent-preset/src/client/index.ts，order20 | AgentPresetSection.module.css `.section` max720；`.cards` repeat(auto-fill,minmax(268px,1fr))，无固定height | 共同root宽度；当内容区小于268时，minmax(268px,1fr)会溢出，需仅此菜单内将最小值改min(268px,100%)或窄时一列 |
| 图片生成 / image-generation | seal-harness-desktop/plugins/image-generation/src/client.jsx，order55 | `.sh-imggen-settings` padding24px32/max600；标题16；`.sh-imggen-settings-row` flex两列且没wrap；actions也是无wrapflex | 解除双重padding/max600；给row/actions允许wrap并给label/input min-width0，不能让窄内容区撑宽 |
| WeKnora / weknora | plugins/weknora/src/client.jsx，order56 | `.sh-weknora-settings` padding24px32/max620；h216；普通form纵向；actions flex gap10；input未统一box-sizing | 解除双重padding/max620，input width100%/min-width0/box-sizing，actions wrap；h2中第二个“模型配置”是组标题，不要一概隐藏 |
| 电脑操作 / computer-use | plugins/computer-use/src/client.jsx，order57 | 当前source已由root改为transparent/零padding、目标卡片顶排flex，而不是截图旧的230px内侧栏；h1仍24/32，h2现在20；dialog fixed560/max-width100/max-height视口-40 | 新壳下无需额外目标左栏。统一root h1为设置级标题尺寸；保留VM编辑/删除dialog的独立定位和滚动，不被“非模态设置”误禁用 |
| Token统计 / token-stats | plugins/token-stats/src/client.jsx，order57 | `.seal-token-page` height100%/overflowauto/padding28px32；子项flex-shrink0；table overflowauto用于横向；viewport850更换padding | 必须在设置作用域改root heightauto/overflowvisible/padding0，否则双滚动和重复留白；保留table横向滚动。charts/cards依据内容宽度断列 |
| 桌面设置 / desktop | dsh-plugin-desktop-beta/src/client/desktop-settings.ts，order100 | `.dshDesktopSettings` width:min(100%,880px)，padding2px0 36；无root固定height/scroll；内部可读URL自己overflow-x:auto，确认LAN dialog固定440 | 统一root宽度和inset即可。不能重置内部URL横向滚动或LAN确认框maxwidth；长页面由外壳body滚动 |

## 条件菜单

`ui-settings-account/src/client/index.ts`仅在账号视图`credential-stored`时登记`account`（order-10），并在状态变化时注销。新壳应继续用原useSections，不把截图10项固定成永远的数组；账号行和未来插件菜单必须能晚到/消失并正确回落。

## 建议的作用域

新壳在每个当前section外提供稳定属性，例如`data-seal-settings-section="token-stats"`。通用root约束应落在该容器的**slot输出顶层**，不落到全局`h2/div/input`。产品固定类可精确覆盖：

- `[data-seal-settings-section="image-generation"] .sh-imggen-settings`
- `[data-seal-settings-section="weknora"] .sh-weknora-settings`
- `[data-seal-settings-section="token-stats"] .seal-token-page`
- `[data-seal-settings-section="ask-jev"] .ask-jev-settings-page`
- `[data-seal-settings-section="desktop"] .dshDesktopSettings`

Models/Plugins/AgentPreset采用CSS module，避免依赖生成hash。可给slot输出根元素统一width100%/min-width0/max-width:none，限制在当前section-id和slot根层级；不要把所有后代max-width都取消。

## 不应误改的限制

- Models的`.fetchDialog` max520及`.candidateList` max-height320/overflow-y:auto属于嵌套取模型对话框，应该保留。
- Desktop的`.dshDesktopSettingsUrls`横向滚动用于长URL，`.dshDesktopSettingsDialog`的440px宽度与LAN授权确认保留。
- Agent预设的GuideDialog、电脑操作VM表单、模型fetch dialog仍是功能需要的弹窗；用户要求取消的是**设置外壳**模态，不是禁止所有二级确认弹窗。
- Plugins子tab的hidden已访问状态是保留草稿的功能，不应为全页布局强行卸载/全显示。
- 外壳顶部settings.action可能含4个长按钮（配置文件/诊断/终端/重启），需flex-wrap且高度auto，不占用右侧页面的固定巨大空白。

## 实机逐项核对清单

宽屏和窄窗口至少检查所有当前useSections条目：无body横向溢出，第一列inset一致；菜单自身可滚动；右body可滚到底到达保存/启用按钮。针对模型展开一张provider编辑卡、Agent预设卡、图片生成双列字段、Token横向表格和桌面长URL单独检查。电脑操作至少打开并取消一次添加VM表单，证明新壳未遮挡嵌套dialog。
