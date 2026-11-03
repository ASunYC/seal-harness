# 电脑操作仅在设置提供入口

- 删除conversation.input.left中的电脑操作按钮、浮层及首页导航resource注册。
- 使用公开settings.section新增电脑操作菜单；复用原管理页、本机/VM配置、状态、后台启停。
- 设置标准useSessions从公开SessionList的retainedBy.mainView确定当前会话，显示名称并传给原面板；没有当前会话时引导先打开会话，不提供失效的旧入口。
- 保持Host所有后台、会话/账号隔离和取消规则，不新增全局自动控制授权，不修改上游。
- 边界：computer-use Client/样式/UI回归、对应文档/规范；不动其他窗口Univer移除。
- 验收：设置菜单仅有一个入口，首页/输入栏无入口；设置当前会话启停有效，本机默认和VM配置保留；定向测试、产品检查和实际设置窗口核对。不提交/推送。

## 完成结果

设置唯一入口、当前会话启停/本机默认/VM管理实际核对通过，首页和输入栏无电脑操作按钮。30项插件测试通过，完整产品check及真实Electron/Profile通过。

重启核对发现旧电脑操作记录直接使用数字开头账号UUID，原生credentialKey校验拒绝，已改为官方构造的account-SHA256键并补原生parseCredentialsDocument回归。已停机备份、仅迁移本插件的1条旧键，payload与其他记录保持；备份留在用户.seal-harness目录。新配置实际保存→重启健康→读取保留→清理QA配置通过。

构建/测试日志在.build/computer-use-settings-{build,tests,check}.log，实机脚本computer-use-settings-smoke.mjs及restart-check.mjs。未提交/推送，保留其他窗口的Univer修改。
