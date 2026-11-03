# 设置页浅深主题

用户截图显示浅色模型设置页内自定义推理档位仍为深色底且黑字难读。修复源CSS的旧--panel/--ink等变量，改用实际DSW主题语义变量；不更改推理档位保存、模型或凭据行为。顺带修复Token说明/错误及电脑操作错误文字的固定暗色配色，保持浅深模式一致。

验收：浅色/深色真实浏览器卡片、文字、输入、按钮可读；默认用户主题恢复；设置10菜单自定义区域抽查；已有推理功能测试与相关Client测试通过；构建并实机检查，不提交/推送。

仅改产品CSS/规范与任务，保留已有SettingsPage/Univer及终端文案变更。

实机抽查还发现图片生成/WeKnora说明文字仍使用旧--text-secondary固定#888回退，浅色对比不足；同一主题根因一起改为DSW语义色，表单/链接/状态色保持当前主题。

## 结果

修复model-reasoning、Token说明/状态、computer-use错误、image-generation/WeKnora旧颜色变量；均为样式，不改模型/凭据/保存行为。完整产品构建及最终Brand/插件装配、12项既有功能回归、产品verify通过，当前Renderer健康且无插件导入告警。

实机通过通用设置切换浅/深主题，推理卡片、标题、说明、select、输入和按钮对比均>=4.5；浅色标题18.90、说明5.80，深色标题13.34、说明9.25。4个其他自定义设置区说明文字也用同一语义色，通过对比采样。原用户偏好跟随系统已恢复，没有保存测试推理草稿。

日志.build/settings-theme-final-{tests,smoke}.log、settings-theme-build.log、settings-theme-final-build.log；浅深截图settings-theme-light.png/dark.png。未提交/推送。
