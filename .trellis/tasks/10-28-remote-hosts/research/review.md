# 独立审查

检查范围：config/service/index/clients，按当前进行中的源码审查，不改其他worker的文件。

## 已核对

- RPC严格envelope，Host自行取当前账号；主机查询/编辑/删除按user_id隔离。
- 退出/epoch变化、主机修改或删除、request abort和插件卸载取消检查，旧结果不返回。
- 原本截图、输入、断开路由已移除；配置无密码字段；连接结果不声称认证完成。
- Windows参数通过单独base64 JSON进入固定PowerShell broker，Windows命令行引用处理反斜杠/双引号；macOS参数与固定AppleScript分离并进行shell单引号引用；Linux使用argv。
- 子进程环境白名单，不继承API秘密或ELECTRON_RUN_AS_NODE；不禁用主机/证书验证。

## 反馈主会话（待集成核对）

1. clients抛出的普通Error会被RPC层统一遮蔽，使缺少客户端的安装/路径指引变为泛化失败。建议已清洗的用户错误用RemoteHostError类型，保留原始异常遮蔽。
2. macOS osascript仅等待spawn就报告成功，Automation拒绝或AppleScript失败仍会声称启动；建议作为短命broker等待exit，与PowerShell一致。Linux终端初始spawn无法证实窗口/协议客户端就绪，应使用“启动请求已发送”等精确状态，或实现启动失败观察。

## 验证

集成复核：以上两项已由客户端worker修复，预期错误使用RemoteHostError保留安装说明；macOS broker等待退出；Host消息统一为“客户端启动请求已发送”，不保证外部窗口或登录已就绪。

- Node24 --check：config.js/service.js/index.js/clients.js通过。
- service+local-data测试9项通过。
- clients+Host测试10项通过，含真实本地TCP socket/拒绝连接、Windows PowerShell固定broker数据解析、argv夹具。
- 此JS插件没有独立lint/typecheck命令；没有运行全产品构建，由主会话负责集成门禁。
- 不把以上夹具当作真实SSH登录、RDP/VNC桌面或macOS/Linux设备验证。
