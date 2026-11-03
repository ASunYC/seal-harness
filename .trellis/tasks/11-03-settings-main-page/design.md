# 设置全页呈现

用户最终要求取消设置弹窗，点击设置后与其他一级页面一样占据主内容区，保留最左一级导航，页内左分类/右内容，自适应窗口，不再强制16:9。此前所有设置菜单适配继续完成。不提交。

只改产品navigation呈现模块/对应测试，电脑操作页面按设置容器宽度适配；不编辑只读deepseek-harness，不改上游Stable/Beta。复用原settings.section及settings.action，保留原表单、快捷键、IPC/深链、onboarding及connection/update逻辑。

建议公开slot适配：在navigation/src/settings-page.jsx通过slots.entries('sidebar.settings')取得官方登记的options/store/inject/children/Component，保留其store及children契约，用更低priority注册产品presentation包装。包装监听真实useStore/open/activeId，把打开请求路由到main key seal-harness-settings；原SettingsRoot仍渲染，但透传useStore时映射open=false，让原modal不挂载，保留其他功能及onboarding。原始store.actions仍用于快捷键、openSection和分类选择。main页使用同一props.renderSlot/useSections呈现原section与actions。必须通过真实slot/Cordis或等价原生store测试验证，不能只用CSS把模态框撑大或移动portalDOM。

处理late registration、原模块HMR/卸载；排除自己注册entry避免递归。打开请求只在open跃迁/activeId外部变化时导航，离开settings时close原store，避免重开抢回。close回到原生会话，section.close保持原行为。设置主页面无role=dialog/aria-modal/inert遮罩。导航底部设置按钮aria-current正确。header actions不丢，所有section label动态取原注册列表。

菜单适配统一外层padding/标题/纵向scroll，左栏固定合理宽度独立滚动，右侧不被原居中max-width和height100%挤坏；电脑操作的目标列表在内容区窄时换成顶部列表，去背景色块。宽屏/常规/窄窗检查全部设置菜单与嵌套弹窗，不卡按钮、不双滚动、不溢出。

## 已确认扩展缺口与最小补丁

真实SlotCore禁止重复声明child slots，且renderSlot校验登记者authority；不能克隆sidebar.settings的children或修改第三方登记元数据绕过。改为现有patches/dsh-client-ui-settings-general@0.2.1-rc.5.patch增加可选settings.presentation单例slot，向产品传递rows/activeId/onSelect/onClose以及原owner绑定的renderSection/renderActions/renderHeader回调。未提供产品presentation时原SettingsPanel fallback完全保留；原store/shortcuts/onboarding/connection留在官方壳。不编辑只读子模块、不重新声明原children。根Yarn lock记录补丁哈希。
