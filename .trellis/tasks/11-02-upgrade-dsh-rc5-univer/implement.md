# 执行顺序

1. 核对tag、npm元信息、现有补丁与Profile安装通道；备份用户SQLite和非依赖配置，记录运行中任务/草稿。
2. 调整固定子模块pin，准备官方rc.5原始运行时集合并验证哈希，逐个移植现有补丁。
3. 更新依赖和AA兼容来源，根不可变安装；类型、变体、运行时及产品构建/检查，修复真实兼容差异。
4. 在实际desktop Profile安装固定版dsh-univer-office，检查第三方DSH依赖是否与Host一致并关闭匿名遥测。
5. 重启应用，验证历史/新会话、Univer激活与Office操作；更新契约和升级记录，不自动提交/推送/发布。

## 当前证据

- 工作区起点main 84d5766a，原本干净；工作分支codex/upgrade-dsh-rc5-univer。Trellis CLI 0.6.17使用已安装Node24运行，未升级模板。
- 备份 `.build/dsh-rc5-backup-20261102-000759` 包含SQLite一致性备份（integrity_check=ok）、全部非依赖Profile配置及Home根配置文件；未输出凭据内容。本轮开始没有运行的Seal Electron主进程。
- 新pin：官方dsh-v0.2.1-rc.5 / b830ec950faba0a46dda564be3e2d854afed94f1。子模块内部干净。
- 344个官方npm包均校验发布元信息/SRI，并保留原始tarball及SHA256清单；sync-vendored-runtime --check --channel beta通过。
- 24份叶子补丁中23份直接移植；会话补丁重新按rc.5生成，只增加原有三个Desktop data-*标记，保留上游新增更多菜单。全部补丁检查通过。
- Beta/Market、产品插件和独立Ask Jev的DSH范围已改为rc.5，Stable/Next保留原内核；保留产品manifest原有格式。
- npm确认dsh-univer-office最新版0.3.9，依赖范围含^0.2.1-rc.3，可接受rc.5；尚未安装到用户Profile。
- AA桥接沿已有7fe1fce32650483bf8433f7a198032178580ff16源码重新准备新peer范围产物，非发布操作，不顺带更新AA功能。当前正在执行既有aa:prepare-release。
- CodeGraph排队45秒后返回busy允许本步使用内置工具，已按当前源码/脚本和上次升级记录核对；不升级索引或修改只读子模块源码。

## 依赖准备完成

- AA首次在隔离构建的Yarn依赖解析阶段遇到网络超时相关onCancel错误；原流程自动恢复清单/锁。没有放宽测试门禁、升级Yarn或修改AA源码。第二次仅将该进程的YARN_NPM_REGISTRY_SERVER设为官方npm并限定网络并发，解析、安装、build/typecheck/check:build与打包通过。
- 新AA产物为2.0.3-desktop.c7fe1fce32650.r2fde147a，源码commit不变，runtimePeers接受0.2.0-rc.2或0.2.1-rc.5。原产物保留。
- 根依赖安装及不可变安装通过；Yarn维持4.18.0。实际Beta安装的@deepseek-ai/dsh为0.2.1-rc.5，202共享源码对齐、344原始包验证通过。
- 完整产品构建通过。类型检查发现新版侧栏声明引用analytics类型，为Market补齐同版本开发依赖后通过；Stable/Beta/Market/Next分别验证完成。没有开启遥测。

## 安装和验收完成

- 完整seal-harness:check通过，包含19个产品插件、真实Electron standard新会话/24个浏览器MCP工具、Creator/插件管理器/两轮HMR；Beta相关29项回归、双变体各1项旧会话迁移通过。
- 根最终不可变安装通过。额外check:layout被基线README.i18n.yaml中文blob记录过期阻断；README三个文件无本轮改动，未伪造翻译核对或顺带修改。
- 使用实际Desktop CLI安装dsh-univer-office@0.3.9，Profile保留base/web-app并追加Office；无额外@deepseek-ai依赖树。pnpm第一次大包下载超时，保留缓存并仅将该安装的fetch-timeout增至600000后完成。未执行包安装脚本。
- Profile原有YAML原文保留，仅追加univer的telemetry:false；启动环境也设DO_NOT_TRACK=1。
- 初始隔离测试直接导入外部Profile模块，未被Loader归属追踪；改用实际Profile的createRequire.resolve公开入口后解析正常。此为验证脚手架修正，未放宽产品解析器或复制运行时。
- 14个Office工具在真实Electron Host中注册；隔离新会话完成univer_new/worktree/unit/execute/inspect/export，文本和数字读回一致，Excel ZIP/XML及内容校验通过。
- Viewer按正式认证cookie及sessionId/file范围访问返回200/HTML；省略身份或范围仍拒绝。实际GUI保留登录及历史会话，启动清单含Office，无恢复页；实际Gateway启动返回200和running，Viewer runtime-config为200。
- 应用保持启动供用户测试。未发送模型消息；仅Windows实测。升级记录见docs/seal-harness/dsh-021-rc5-univer.md。
- 初次安装完成时未获提交/推送/发布授权，保留工作分支和可审阅改动。

## 2026-11-03 主分支同步

- 用户明确授权提交并推送线上main；内核pin已独立提交53399025，后续兼容修复及Office装配机制已在同分支分别提交。
- 剩余办公导航文案与升级记录按功能分开提交。提交前重新构建导航并通过客户端回归；check:layout通过，README旧阻塞已由cec3bbf3修复。
- 更广的平台回归限制及Office分发边界保留在11-03-bundled-office任务，不把本机14工具及Excel验证当作商业安装包或完整跨平台门禁通过。
- 本次不生成安装器、不发布Release、不提交用户Profile或凭据。
