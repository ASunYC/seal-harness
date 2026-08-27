# Seal Harness v0.3.2

DSH Web 主题视觉兼容修复。

## 修复

- 为 Seal WebUI 增加 DSH `data-pane`、`data-phase`、conversation、chat-flow、composer 与
  sidebar slot 语义；
- 让 DSH Client 主题能够找到真实挂载点，而不再只执行 Bundle 和修改 body 颜色；
- 支持主题注入人物舞台、宫殿背景、顶部/底部饰边、侧栏角框和吉祥物；
- Session 列表补充 tree/treeitem 与 selected 语义；
- Client 状态诊断增加 characterStage、sidebarMascot、topTrim 和 conversationPane 证据。

## Deep Whale 验证

`maid-atelier` 的浏览器运行状态已确认：

```text
active=true
characterStage=true
sidebarMascot=true
topTrim=true
conversationPane=true
```

这是 `v0.3.1` 的补丁修复，不改变插件安装命令和隔离 Profile 格式。
