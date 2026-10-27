# 本地身份

`@seal-harness/identity` 在 Host 内提供本地账号服务。首次启动只能创建一个管理员账号；用户名和密码登录后生成当前运行期会话。勾选“记住登录状态”后可在 30 天内跨重启恢复；退出、改密或到期后需重新登录。企业微信、SSO 和远端密码登录不属于本地账号流程。

用户记录保存在基础 `DSH_HOME`（默认 `~/.seal-harness`）下的 `seal-harness.sqlite` 的 `users` 表。密码使用独立随机 salt 和 Node `scrypt` 哈希。记住登录使用随机凭证：渲染器持久分区保存凭证，数据库的 `remembered_logins` 只保存其哈希、账号和到期时间，不保存明文密码或登录凭证。`plugins/local-data` 统一负责建表和事务，身份插件不创建第二个数据库。

Host RPC 为 `status`、`register`、`login`、`resume`、`logout`、`password/change`，Client 通过 `sealHarnessAuthClient` 订阅会话并显示 Seal Harness 登录页。登录滑块是本地界面交互，不充当服务端安全验证码。对外部能力目录仍可通过 `sealHarnessServices` 显式配置服务地址，但这些地址不参与本地登录；本地账号令牌被明确拦截，不会发送至远端能力服务。

原有本地能力文件会在对应模块首次登录时复制到 SQLite，原文件保留。旧远端账号记录不会自动导入。
