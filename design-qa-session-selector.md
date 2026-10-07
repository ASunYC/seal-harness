# 会话选择器设计 QA

- source visual truth path: `C:/Users/Lenovo/AppData/Local/Temp/codex-clipboard-15adbfbe-2349-4fa2-9c2a-45cf76229e10.png`
- implementation screenshot path: unavailable
- viewport: Seal Harness桌面窗口，实际窗口约 1348 × 825
- source pixels: 746 × 261；implementation pixels/CSS size/density: unavailable
- state: 会话输入框底部工具栏

## Full-view comparison evidence

源图已打开并核对：目标是“能力 / 连接器 / 智能助手”三枚相邻胶囊入口，不是一个“资源”总入口。实现已改为同样的三入口结构，并移除历史会话项。

## Focused region comparison evidence

源图输入栏局部已核对；当前 Windows Computer Use 未返回 Electron 原生窗口，无法取得同状态实现截图，因此不能完成像素级并排比较。

## Findings

- 已修复 P1：入口信息架构错误。原实现将四类资源合并；现已拆为三枚独立入口。
- 待验证：胶囊高度、间距、边框和实际输入栏换行表现。

## Comparison history

- 第一次：用户截图确认“资源”总入口与 Stratex 三入口结构不一致。
- 修复：改为能力、连接器、智能助手三枚 26px 胶囊，使用 DSH 图标与 6px 间距。
- 后续证据：因原生窗口捕获不可用，尚无实现截图。

final result: blocked
