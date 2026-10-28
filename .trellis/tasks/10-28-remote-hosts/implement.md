# 实施

1. 主会话负责schema、存储迁移、Host RPC与服务/隔离测试、文档、集成构建。
2. 客户端worker负责clients.js及专用tests，原生SSH/RDP/VNC启动、发现、连通性探测。
3. UI worker负责client.jsx/styles.js及client.test.mjs，多主机管理和缺失客户端提示。
4. 检查worker审查连接边界与测试，主会话串行集成并进行宽窄窗口实机测试。所有人不提交，保留其他窗口修改。

先定向、后完整产品build/check/Profile；真实远端认证与桌面后续由用户换机验证。

## 已完成

- 删除本机driver/input及旧截图控制测试；新增主机schema/service/五个RPC、local-data v8迁移和存储隔离测试。
- 原生客户端发现、参数安全引用、TCP检查及取消；两位worker完成客户端/UI，一位checker独立审查。缺失客户端错误透传和macOS启动broker等待问题已修复。
- 26项定向测试通过（service+local-data 9，UI+clients+Host 17）；完整产品构建通过，最新插件再次构建安装。
- Windows Electron实机：UI创建SSH及另外两种配置，搜索、检查、缺失客户端错误、编辑、取消删除；700px及宽窗口无横向溢出。所有QA配置已删除，真实主机未连接。
- 已备份本机迁移前SQLite到忽略的.build；应用重启健康，当前数据库v8。
- 完整check首次发现organization/apps历史fixture仍按v7断言，已同步相关fixture/期望值到v8；重跑完整check通过（品牌及18个业务插件、重复Profile、资源、零更新请求、真实Electron standard会话和24个浏览器工具、Creator/插件管理与两轮HMR）。
- 无远端设备，真实SSH/RDP/VNC登录与桌面、macOS/Linux运行留待用户换机验收；插件README含逐项清单。
