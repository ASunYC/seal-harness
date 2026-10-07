# 连接器目录 Tab 设计 QA

- source visual truth path: `C:/Users/Lenovo/AppData/Local/Temp/codex-clipboard-d6763f4a-f6da-4fcc-a562-2958450188ba.png`
- implementation screenshot path: `C:/Users/Lenovo/AppData/Local/Temp/seal-harness-connector-tabs.png`
- focused comparison path: `C:/Users/Lenovo/AppData/Local/Temp/connector-tabs-comparison.png`
- viewport: Seal Harness桌面窗口 1438 × 900 CSS px，Windows device scale factor 1
- source pixels: 303 × 162；implementation pixels: 1438 × 900
- focused crops: source 190 × 62；implementation 240 × 62；均为 1x，不做密度缩放
- state: 深色主题，连接器目录“公开”选中

## Full-view comparison evidence

实现截图显示连接器页保持原有顶栏、Hero、搜索、精选场景与已安装导览；原纵向“个人 / 被授权 / 公开”目录已替换为单行 Tab，一次只呈现当前目录内容。没有产生横向溢出或遮挡侧栏、搜索和目录卡片。

## Focused region comparison evidence

并排局部比较确认：选中项使用约 32px 高、8px 圆角的深灰底，14px 半粗白字；未选项透明背景、白色文字，Tab 间距与技能参考一致。连接器额外保留“被授权”第三项，这是需求要求的真实目录状态，不是视觉漂移。

## Required fidelity surfaces

- Fonts and typography: 复用产品字体变量；字号、字重和选中层级与技能页一致，无换行或截断。
- Spacing and layout rhythm: 8px Tab 间距、4px/12px 内边距、32px 最小高度与参考一致；目录正文与 Tab 保持 16px 间距。
- Colors and visual tokens: 复用 `--raised`、`--ink`、`--muted2`，与技能页同一主题令牌。
- Image quality and asset fidelity: 目标区域没有图片或图标资产，不存在替代或清晰度问题。
- Copy and content: “公开 / 个人 / 被授权”准确对应连接器三种目录范围。

## Interaction evidence

- 点击三个 Tab 只挂载当前 `tabpanel`，不会纵向堆叠。
- ArrowLeft、ArrowRight、Home、End 支持键盘切换；选中项使用 `aria-selected` 和 roving `tabIndex`。
- UI 测试覆盖默认公开、个人切换、被授权空态、公开安装及登录状态。
- Electron Renderer 启动状态为 `healthy`。

## Findings

- 没有可执行的 P0/P1/P2 差异。
- P3：完整连接器页比参考局部包含更多业务区块，属于既有页面结构，不影响本次 Tab 对齐目标。

## Comparison history

- 第一次：实现为三个纵向区块和锚点，属于 P1 交互模型不一致。
- 修复：替换为技能页同款单选 Tab，并加入键盘导航和条件渲染。
- 第二次：1438 × 900 实际 Electron 截图及聚焦并排比较未发现新的 P0/P1/P2。

final result: passed
