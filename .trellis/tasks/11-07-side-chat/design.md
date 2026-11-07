# 设计

新增 Seal Host/Client 插件。Host 通过 DSH `agents.create` 持有侧聊 AgentHandle，侧聊 Session 不加入工作区；Client 通过 `sidebarRightTabs` 注册资源类型，资源提供者持有 DSH Session reference。页签用 `SessionProvider` 切换到侧聊 Session，再渲染 `conversation.content` 的 embedded 变体。关闭页签后，Client 等待资源引用释放并调用 Host 清理；Host 先 dispose AgentHandle，再仅删除带专用 ID 前缀的会话日志与投影缓存。重启后已打开页签通过 Host 恢复 AgentHandle。旧版误加入工作区的侧聊在 Host 启动时解除工作区归属。选中文本经右侧资源导航参数传到侧聊草稿。不改上游实现。
