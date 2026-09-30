# 远程控制弹窗品牌名称

## 目标

Seal Harness 构建中的原生远程控制弹窗，标题正文和说明正文不再显示 DeepSeek Harness，而显示 Seal Harness。

## 边界

- 文案源位于 Desktop 原生 `remote-control-offer.ts`，产品插件无法通过公开 slot 修改系统消息框。
- 仅将两处中英文品牌词换成产品配置名称；上游默认构建继续显示原有 DeepSeek Harness。
- 同步 Stable/Beta 两个共享 Desktop 变体及定向测试，不改变远程控制开关、确认或重启行为。

## 验收

- [x] Seal Harness 产品配置下中英文弹窗文案均使用 Seal Harness。
- [x] 无产品配置时中英文默认文案保持原样。
- [x] 双变体检查、相关测试和产品构建通过。
