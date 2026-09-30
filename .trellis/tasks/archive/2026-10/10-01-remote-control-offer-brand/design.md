# 最小接口适配

在两个 Desktop 变体的 `remote-control-offer.ts` 引入公开的 `DESKTOP_PRODUCT` 与 `DESKTOP_PRODUCT_IS_CUSTOM`。以自定义产品名构成中英文确认文案；默认构建继续使用原有 DeepSeek Harness 字符串。`electron-runtime.ts` 已直接读取此文案，不改原生消息框生命周期。测试分别验证默认和显式产品配置，避免 Seal Harness 名称泄入上游发行。
