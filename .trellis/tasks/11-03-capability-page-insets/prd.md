# 统一能力子页面边距

用户要求插件、技能、连接器、应用四页左右边距与插件市场一致。市场基准为--seal-page-inset(宽32/<=800时20)+9px滚动条对称gutter；四页现为48px侧padding+960px居中上限。仅navigation/page-styles.js在能力激活范围统一根横向padding/gutter并解除直属header/content960cap；不改纵向布局、表单/卡片padding、弹窗、其他菜单或市场自身。

验收：五页宽/中/窄视口左右header及body边界差<=1px，无页面横向溢出。插件/技能/连接器/应用实际均打开、交互不变；navigation既有测试及产品verify通过。不提交/推送，保留其他修改。
