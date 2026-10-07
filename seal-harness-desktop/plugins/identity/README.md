# 本地身份

`@seal-harness/identity` 在 Host 内提供本地账号服务。首次启动只能创建一个管理员账号；用户名和密码登录后生成仅在当前运行期有效的会话，退出或重启后需重新登录。企业微信、SSO、远端密码登录和会话恢复入口已移除。

用户记录保存在基础 `DSH_HOME`（默认 `~/.seal-harness`）下的 `seal-harness.sqlite` 的 `users` 表。密码使用独立随机 salt 和 Node `scrypt` 哈希，数据库不保存明文密码或登录令牌。`plugins/local-data` 统一负责建表和事务，身份插件不创建第二个数据库。

Host RPC 为 `status`、`register`、`login`、`logout`、`password/change`，Client 通过 `sealHarnessAuthClient` 订阅会话并显示 Seal Harness 登录页。对外部能力目录仍可通过 `sealHarnessServices` 显式配置服务地址，但这些地址不参与本地登录；本地账号令牌被明确拦截，不会发送至远端能力服务。

原有本地能力文件会在对应模块首次登录时复制到 SQLite，原文件保留。旧远端账号记录不会自动导入。
