# 本地技能

技能状态及包内容分别存于基础 Home 的 `seal-harness.sqlite` 的 `skill_state`、`skills` 表，按本地账号隔离。原有本地技能状态和包在首次登录时复制导入，原文件保留。包会物化到 `seal-harness-cache/skills/packages` 供 DSH Skill Registry 使用；缓存删除后可从数据库恢复。

技能页展示本地管理、创建、导入、发现、启停和导出，不要求开发者平台。原云端安装协议代码仍在能力模块中，但本地账号令牌不会发送至远端服务；当前产品不提供云端安装入口。
