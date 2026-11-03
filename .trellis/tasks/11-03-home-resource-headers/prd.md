# 组织与专家页头统一

组织架构、专家的页头与能力中的技能/连接器一致：20px/28px、500字重，顶部28px、横向共用页面inset和对称滚动槽、页头到正文32px。移除返回箭头、装饰标签和标题横线。页头按钮统一32px、13px字体及中性色主次按钮，不使用蓝色。

边界：organization/client.jsx与experts/panel.jsx调整页头标记；navigation/page-styles.js统一产品排版；organization/styles.js移除硬编码蓝色主按钮。保留业务数据、目录/卡片及弹窗行为，不改上游或能力现有页面。

验收：真实Electron宽中窄窗口对比能力页标题字体、留白及按钮样式；浅深主题检查；相关测试、产品构建及verify通过。不提交、不推送。
