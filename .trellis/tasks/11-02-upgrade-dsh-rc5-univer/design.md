# 边界与来源

Seal当前直接装配dsh-plugin-desktop-beta，upstream.json为0.2.1-rc.2；Stable为0.2.0-rc.2，Next为0.1.7-alpha.2。官方2026-10-30发布的dsh-v0.2.1-rc.5是本轮目标，Univer最新源码声明支持^0.2.1-rc.3，需核对实际npm发布版本。

复用既有vendor格式、sync-vendored-runtime校验、根Yarn4和Node24工具链。优先下载官方npm集合并校验SRI/源提交，不重新构建或编辑内核。按新包内容移植24个现有rc.2叶子补丁，哈希chunk路径变化必须核对，不盲目替换。根resolutions、Beta/Market及Seal插件peer范围统一到rc.5；AA桥接仅处理实际兼容门禁，非发布任务不顺带更新AA功能。

先记录旧运行时与Profile可恢复快照，再调整源码pin与运行时。实际Profile的插件安装通过既有desktop-cli的manageDesktopProfile及随包pnpm策略执行，不建立第二套产品运行时或修改Home归属。用户Profile安装是本机状态，不提交其凭据或node_modules；安装版本与验证步骤记入文档。

编译与隔离Profile通过后重启真正的应用，再核对Host版本/路由、会话和Univer工具。优先在临时工作区验证Office文件，不覆盖用户文档。不把工具注册、GUI存活或生成文件名当作文件内容正确的证据；真实Word/Excel/PPT互通及跨平台分别记录。
