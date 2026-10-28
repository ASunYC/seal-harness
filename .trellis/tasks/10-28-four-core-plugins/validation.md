# 四个工作台插件验收记录

日期：2026-10-28。基线为 main `a6d5b729`，保留此前反馈移除和导航布局的未提交改动。本轮无 Git 提交、推送或发布。

## 模块实现与验证

| 模块 | 已实现 | 定向测试与实际证据 |
| --- | --- | --- |
| Token | 真实 Session Projection 用量、轮次账号归属/去重、日期/时区/专家/模型维度、四表 XLSX | 8项通过，含实际 Cordis Session 事件→Projection→RPC、重启/卸载重装、Excel ZIP/XML；实际产品 RPC snapshot/export 成功 |
| 知识库 | 每账号 WeKnora 连接复用，库CRUD、文档导入/解析状态/预览/删除/重解析、来源检索、设置入口 | knowledge+weknora 12项通过，含受控HTTP完整闭环、权限/取消/大小限制、UI；上游六个JS哈希不变 |
| 远程桌面 | Windows 主屏截图、显式只读连接、可选键鼠、epoch/连接/帧约束、取消/空闲释放 | 17项通过；真实 Node与Electron均成功截图；实际页面只读连接→图片解码→断开成功，无真实输入 |
| ACP | 7预设+自定义Runner、配置/发现/协议检查、任务流输出/取消、账号凭据、两个模型工具 | 14项通过；真实SDK fixture与DSH LocalSubprocessRuntime握手/执行/取消、权限/环境/并发/未知清理状态；实际页面与snapshot显示7预设 |

四块相关定向测试合计51项通过；另有两轮独立只读交叉审查，见 `research/cross-review.md` 与 `research/acp-review.md`。不把重复复测计为新增测试。

## 交叉检查修复

- 远程页面不再从status自动附着旧连接，文字失败保留草稿。
- ACP配置修改与launch互斥；清理失败保留占用，阻止未知旧进程仍存活时继续启动。
- ACP修正非法stderr disposition、查找程序期间取消、显式PATH、stdout错误处理及取消后的权限请求。
- 实际主题视觉检查修正知识库和桌面主按钮白底白字。

## 共享与产品门禁

- local-data v7统一迁移，添加token_usage_turns及acp_runners；v2/v4/v5/v6升级保留原有用户/登录/组织/技能数据。数据库与apps定向13项通过；组织迁移也由完整check覆盖。
- 修改实际用户数据库前，以SQLite backup保留v6快照在忽略文件 `.build/four-core-before-migration.sqlite`。未还原/覆盖用户数据。
- 导航新增primary注册语义，四块顺序为自动化任务之后、空间之前。导航2项测试通过；Chromium夹具验证兼容/扩展/高级×宽/窄×收起/展开12组，及9菜单短窗口滚动，保留右栏/固定设置/首页偏好。
- 完整产品build通过，日志 `.build/four-core-build.log`。首次check在未改动的store HTTP分页验证用例中出现unreachable/invalidResponse差异；该文件13项单独复测通过，没有修改或放宽断言。完整复跑 `.build/four-core-check-retry.log` 退出0。
- 完整check包含18个产品插件、真实Electron standard会话、24个浏览器MCP工具、Creator、插件管理器和两轮HMR。
- 最终ACP收尾和按钮配色之后再次完整build、再次真实Profile验证通过：`.build/four-core-final-build.log`、`.build/four-core-final-profile.log`。
- Windows终版Electron进程31976启动 `rendererStatus: healthy`。整机脚本 `.build/four-core-smoke.mjs` 最终退出0：四页标题/顺序正确，非首页宽侧栏0px、内容紧邻56px一级栏；知识库设置抽屉可开关；桌面主按钮前景rgb(21,21,23)/背景rgb(249,250,251)；只读连接的真实1400×788图像能解码；返回首页恢复原宽度。Runtime异常计数0。
- 实际RPC验收：当前账号统计可读、XLSX四工作表可解析、WeKnora状态不返回Key、ACP7预设可读、桌面RPC只读截图和断开成功。没有写入模拟统计或测试Runner到实际用户库。
- `git diff --check`通过；`git -C deepseek-harness status --porcelain`为空，上游子模块未改。

## 实际依赖及未验证范围

- 当前WeKnora未配置Key，loopback服务不通、Docker引擎未运行；实际页面显示连接引导。管理/检索完整闭环已用受控服务测试，但没有对真实WeKnora写库/运行Embedding/OCR。产品不重复部署ONNX引擎，也不自动部署服务或升级Key权限。
- 七种第三方ACP CLI/adapter没有用用户真实账号/付费模型验证，不自动安装或登录。程序发现、协议检查与任务执行是不同状态；Windows脚本入口按公开进程能力给出Node+JS配置提示。
- Windows实际截图已验证；真实鼠标键盘输入没有执行，以驱动映射、异常释放与权限/生命周期测试覆盖。手机配对及macOS/Linux桌面驱动尚未实现，明确显示不可用。
- macOS/Linux图形启动、平台安装包、签名/公证、跨设备远控不在本机通过范围内。布局夹具和headless Profile不能替代这些实际验收。

应用保持运行，最后停在首页，所有改动待用户后续审阅/提交。
