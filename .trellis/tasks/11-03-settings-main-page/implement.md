# 实施分工

1. settings presenter worker：navigation/src/settings-page.jsx + settings-page-styles.js；通过原有公开slot复用原store和sections/actions，把modal呈现变为main页。根会话负责client.jsx集成调用/导航aria-current。
2. settings tests worker：navigation/tests/settings-page.test.mjs，验证原store/slot替换、快捷键打开分类、离开页面、late/HMR、非模态和完整sections/actions。
3. 根会话负责电脑操作及各菜单真实适配、构建、全页逐项实机审查、完整门禁、文档。所有人保留其他窗口修改，不提交。

## 验证结果

- 采用最小可选presentation seam，默认上游modalfallback不变。Yarnskip-build安装成功，lock只有该patch解析/校验和变化，vendor与只读子模块未改。
- 原生SlotCore重复声明问题被测试及时识别，已改公开owner回调。真实Cordis/SlotRegistry+原生shell的5项新测试通过；全部navigation/computer-use39项通过。
- 当前10菜单（general/models/plugins/ask-jev/agent-presets/image-generation/weknora/computer-use/token-stats/desktop）宽屏及1000/700视口共30状态无横向溢出，rootpadding/宽度统一，Token根overflowvisible/padding0，表格局部横向滚动保留。
- 实际全页无settings modal/aria-modal/#root inert；设置gear高亮、离开办公不抢回、再次打开正常；Cua VM二级dialog定位/可见/取消保留设置页正常。CDP合成Ctrl+,未触发原生键盘通道，未作为硬件快捷键实测结论；原生shortcut动作回调由原壳集成回归验证。
- product plugins构建安装、完整check及真实Electron Profile（standard/24浏览器工具/Creator/插件管理/两轮HMR）通过；check:desktop-variants203共享源对齐。
- 日志.build/settings-main-{final-build,focused,check,wide,narrow,variants}.log，图片settings-main-wide.png/narrow.png，交互脚本settings-main-interactions.mjs。
- 保留Univer移除等其他窗口改动，无提交或推送。

最终完整产品build通过；构建后再次运行verify及真实verify-profile通过（.build/settings-main-product-build.log、settings-main-artifact-verify.log）。未提交。
