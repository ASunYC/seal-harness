# Seal Harness用户插件

常驻的身份入口与用户详情页。Client 依赖 `@seal-harness/identity` 提供的身份状态服务；未登录时显示“未登录”，点击打开登录页；登录后显示用户名称与详情。入口通过 `sidebar.footer.action` 插槽注册，并在Seal Harness产品中排到设置行下方；详情页通过 `main` 键 `seal-harness-user` 打开。退出登录调用身份插件，不保存第二份令牌或用户状态。

此插件只负责用户界面，不承担 DSH Home 的用户隔离。Host 入口与上游浏览器 UI 插件相同，无额外服务行为。
