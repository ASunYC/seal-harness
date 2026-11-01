# 设计

- 自动化任务：DSH `TaskManagerPage` 已含 listPane 和条件渲染的 TaskDetail。通过产品导航样式基于 `data-testid="task-manager-page"` 调整原生容器的列宽；未选中时给右侧可见引导。不复制上游列表、数据或动作。
- 远程主机：在现有 `RemoteDesktopPanel` 内保存 selectedId。左侧列表沿用查询与协议筛选；右侧仅渲染选中主机的原有详情与按钮。快照变化时从当前可见结果推导有效选择，避免删除或筛选后的旧主机详情。模态表单与请求生命周期不变。
- 宽度不足时两页改为纵向排列，保持列表和详情可滚动。
