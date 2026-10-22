# DSH 0.2.1-rc.2 升级

将 Seal Harness 使用的 Beta 内核从 0.2.1-alpha.2 升级到官方 dsh-v0.2.1-rc.2。固定 release 的 Git commit、完整官方运行时与来源校验；对齐产品插件依赖，保留现有品牌、账号、专家、技能、连接器、应用、决策和导航行为。

验收：子模块内容不修改；Beta 的 source/runtime/manifest 版本和 SHA 对齐；Stable/Next 保持各自已声明版本；不可变安装、布局/变体检查、类型检查、产品 build/check、实际 Profile 激活通过。真实供应商调用、签名安装和跨平台图形验证单独记录。

范围不含升级 Electron、发布 Seal Harness 或自动推送。子模块 pin 独立提交，不与产品行为适配混合。

验收已完成，实际证据与未执行范围见 implement.md 及 docs/seal-harness/dsh-021-rc2-upgrade.md。
