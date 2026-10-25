# Seal Harness 对标 Octop Enterprise：功能差距

日期：2026-10-25。比较本机 checkout，不代表远端最新发行状态。

- Seal Harness：`D:/git-workspace/AI/seal-harness`，`0214127e2d2c18fd17a134a0f3b616fa3182f5ad`。
- Octop Enterprise：`D:/git-workspace/AI/newwork/Octop-Enterprise`，`469d13fe7db6850d781b9d5695ed796ffa2aa3ed`。
- 本轮为静态源码/文档核对；未启动应用，未做真实模型、第三方服务、企业部署或跨平台安装验证。
- CodeGraph 两仓库查询均返回队列繁忙并允许本步使用内建工具，因此回退到源码与文档读取。

## 结论

Seal 已有可复用的 DSH 执行基础。最直接的补齐方向是系统专家、知识库、长期记忆管理和成果管理；语音、自动化、浏览器等主要是产品完整度差距。企业协作和治理属于另一层建设，需要服务端与设备协议，不能按本地页面补丁估算。

“已有”仅表示已找到产品装配或实现；“缺失”表示当前默认产品中未找到 Octop 对等入口/完整闭环，不表示 DSH 无法通过插件实现。技能目录、MCP 能力、单次工具调用不等同于完整产品功能。

## 功能矩阵

| ID | 功能 | Octop 当前依据与边界 | Seal 当前状态 | 建议补齐 |
| --- | --- | --- | --- | --- |
| F01 | 普通对话、本机文件与命令 | 员工本机单专家任务；文件留在授权目录 [O1] | 已复用 DSH 原生会话/工作区，并装配终端 [S1,S2] | 复用现有内核，围绕文件成果和恢复补齐，不重建聊天引擎 |
| F02 | 专家模板、安装与复用 | 内置场景模板、SkillHub、发布专家快照与安装 [O3] | 个人专家有创建、导入、版本、启用及能力绑定；系统页明确空态 [S3] | 首先提供真实可安装的系统专家，含模型/技能依赖校验、欢迎语和示例任务；公共市场另行接服务 |
| F03 | 技能目录与个人技能 | 技能包、个性化技能管理 [O2] | 已有完整目录、导入、安装和个人创建，不是缺失；目录记录 398 在线条目、9 包/29 技能 [S4] | 验证专家与技能依赖闭环、安装失败反馈、依赖环境就绪；数量不作功能完成度 |
| F04 | 连接器/OAuth/MCP | 服务端连接器与 OAuth/MCP；员工本机运行时不加载外部连接器 [O1,O2] | 已有本机目录、MCP/办公 CLI、凭据管理、工具选择 [S1,S4] | 保留 Seal 现有优势，补状态诊断与专家依赖体验；不因 Octop 服务端限制缩减 Seal |
| F05 | 知识库与检索 | 知识库/文件夹/文档管理、预览、重建索引；企业检索在服务器执行 [O1,O4] | 当前产品明确移除了知识库插件与绑定 [S2] | 新建产品插件：文档导入、解析状态、索引、检索与来源引用、专家/会话选择；OCR/语义检索按实际需求分阶段 |
| F06 | 长期记忆 | 专家记忆原子、候选审核、实体/片段、统计、提取设置和便携包 [O5] | 有会话全文搜索，但无同等记忆管理闭环；上游第三方记忆 MCP 示例默认关闭 [S1,S5] | 优先实现明确记住/检索/更正/遗忘及来源；后补候选审核、自动提取、导入导出。全文搜索不能算长期记忆 |
| F07 | 文件成果与专家交接 | 成果卡片、定位文件、附件导入、转给其他专家；文件有校验与复制语义 [O1,O6] | DSH 原生工作区与工具输出为基础；未确认同等级成果聚合与转交闭环 | 补会话成果列表、预览/定位、来源与版本、选择文字/附件后交给另一专家；保持原文件 |
| F08 | 空间/项目组织 | 工作目录、专家及任务成果组织 [O1]，没有把它们直接叫作 Seal 的“空间” | 空间页只有“尚未开放” [S6] | 建议定义为个人项目容器，关联原生工作区/会话/成果，后续再关联知识库；这是 Seal 产品建议，不是声称 Octop 有同名模块 |
| F09 | 定时任务 | 服务端自动化、运行与投递逻辑 [O7]；依赖服务器运行 | 可见导航指向 DSH schedules；产品 SQLite scheduled-tasks 服务/页面仍保留 [S1,S6,S7] | 先审计两套存储/执行/权限，再决定统一与迁移；任务详情、时区、结果入口和失败处理。关闭 Desktop 后执行需要常驻服务 |
| F10 | 语音输入与朗读 | STT + TTS、模型配置及客户端语音上下文 [O8] | 已装配本地 SenseVoice 和远端 STT；未找到对等默认 TTS 装配 [S1] | 保留输入，补回复朗读、停止播放、音色与状态；不把实时语音通话列为已确认对标项 |
| F11 | 生图、图片编辑和媒体 | 企业配置图像服务；本地工具处理音视频，能力依赖配置 [O1,O9] | 已有 ImageGen/ImageEdit 与设置 [S8]；技能目录含媒体技能但安装不等于运行库就绪 [S4] | 优先完善图片展示、任务进度、失败反馈和成果归档；文档/音视频按真实依赖提供可验证工具链 |
| F12 | 浏览器自动化 | 服务端浏览器、录制、回放与生成技能，依赖 octop-browser [O10] | 已装配 Playwright MCP，当前 product patch 写了 Windows Chrome 绝对路径 [S1] | 补浏览器检测、配置/安装诊断、跨平台路径与可视反馈；录制/回放作为独立增强，不能假定已完成 |
| F13 | 编程 CLI / ACP | 服务端 ACP 管理，本机企业运行时不加载 ACP [O1,O2] | 已有终端；vendor 有 ACP 包，不能由包存在推定产品入口已就绪 | 按需提供 CLI 发现/配置、授权与会话映射；优先调查公开 DSH ACP 服务，不内嵌另一套运行时 |
| F14 | 多 Agent | 源码有 teams/subagents，但员工本机自动多专家协作明确不支持 [O1,O2] | 已装配实验性团队及 UI [S1] | 验证任务分派、状态、取消和结果汇总；属于已有实验能力完善，不应以 Octop 本机现成功能为迁移理由 |
| F15 | 公司通讯录、私聊、群聊 | 企业通信服务、Contacts/Messaging 与权限 [O1,O2,O11] | 当前产品没有企业通信闭环 | 服务端阶段：组织目录、在线状态、成员与群权限、附件存储、实时消息；单独开发和部署 |
| F16 | 转发给同事/群/专家 | 共用转发弹窗、选择内容、多目标、部分失败重试 [O1,O6] | 未确认对等闭环；专家本机转交可先独立建设 | 本机专家交接先做，企业消息转发依赖 F15；每目标结果和重试须避免重复副作用 |
| F17 | 企业账号、角色、SSO/LDAP | 用户/角色/部门、权限目录、OIDC 与 LDAP 实现 [O2,O12] | 本地首个管理员、登录/退出/改密；会话在内存 [S9] | 企业阶段新增远端身份/租户和设备会话，保留本地模式；本地 role 字段不等于企业 RBAC |
| F18 | 模型集中授权与配置刷新 | 管理员模型配置、角色授权、客户端配置通知 [O1,O12,O13] | 已有 DSH 模型与凭据、逐模型推理档位；没有企业统一授权闭环 [S2] | 先改善现有设置；企业阶段增加模型代理/授权和撤权即时生效，不能把服务商密钥下发给每个员工 |
| F19 | 统计、审计与可观测 | 用户/管理员 Token 汇总与导出、审计入口、Langfuse 配置 [O2,O12,O14] | 上游有 token-meter/单轮用量基础；未确认产品级跨会话统计、企业审计台 | 先做按时间/模型/专家的个人统计；有可靠价格才计算费用；企业审计与管理统计后做 |
| F20 | 备份恢复与设备连续性 | 备份/恢复/自动备份；设备通道、本机回执与补传 [O1,O15] | 有 SQLite/原生会话持久化和 Desktop 恢复机制，不能等同完整用户备份/跨设备同步 [S2] | 先导出/恢复产品数据与原生会话并实测；远端历史和设备补传后做，不承诺同步所有本机项目文件 |
| F21 | 外部 IM 通道 | 服务端 channels/Gateway 与自动化投递 [O2,O7]；并非群机器人已支持 [O1] | 办公 CLI/连接器提供工具调用，不等于常驻消息接收渠道 | 独立设计收消息、会话路由、权限和主动投递；不要把连接器数量当通道完成度 |
| F22 | 远程桌面/手机 | 有设备、浏览器、桌面、mobile API/页面，受部署/权限限制 [O2] | DSH Desktop 有远控基础，但未做 Octop 对等逐项验证 | 列为后续专项：设备配对、授权、画面/输入与撤销；当前不能判定完全没有或已经等价 |

## 建议实施顺序与验收

这些阶段是建议，不是已经完成的实现或确定工期。

1. **第一批：系统专家与桌面闭环（F02/F07，F08 可后置）**。安装一个系统专家，校验依赖并完成真实任务；在成果列表定位文件，选择文字/附件交给另一专家并生成新会话。空间如纳入本批，先限定个人项目关联，不替换 DSH 工作区。
2. **第二批：知识和记忆（F05/F06）**。导入文档、看到索引成功/失败，真实问答返回可定位来源；会话 A 记住偏好，重启后新会话 B 能检索并使用；更正/遗忘有效，账号与专家范围清楚。
3. **第三批：自动化与日常体验（F09–F14/F19/F20）**。先完成双调度器审计及历史数据迁移方案，再统一入口；补语音朗读、图片成果、浏览器环境诊断、个人统计与完整备份恢复。CLI/录制回放/团队完善按具体需要拆小任务。
4. **第四批：企业控制层（F17/F18/F20）**。企业登录、角色、模型授权、设备身份与配置刷新；验证撤权生效、断网/重连/补传和本机操作不重复。服务器边界、部署与运维在开始前单独设计。
5. **第五批：企业协作（F15/F16/F21/F19/F22）**。通讯录、私聊、群聊及成果转发，再按需要接 IM、审计和远程设备。验证多目标部分失败重试不会重复已成功发送，附件权限可撤销。

优先级依据：先让个人任务完成与复用，再增加公司共享和管理。若目标明确为企业版，第四批应提前到企业协作与共享知识之前；本轮不代替用户做这一定位决定。

## 约束与实施风险

- 当前 `.trellis/spec/general/desktop-build.md` 明确不装配知识库/项目/产品智能体，identity 只做本地身份。F05/F08/F17 的实施前要修订已确认的新契约，不能悄悄恢复旧插件。
- 产品实现优先放 `seal-harness-desktop/`，复用公开扩展；不改 `deepseek-harness/`，不整体移植 Octop Python/LangGraph 运行时。
- Octop 模板、代码、媒体素材和外部组件分别核验许可及来源；主项目 MIT 不能替代第三方资源授权。
- README 与当前规范/装配有漂移：问问决策描述、可见自动化页对应哪套实现、旧 DSH 版本。以后以实际装配与代码为验收依据，相关文档随阶段修正。
- 浏览器配置中的 Windows Chrome 绝对路径需要跨平台治理；本机可用不等于 macOS/Linux 可用。
- 不对所有继承/可选包宣称缺失；ACP、远控、完整附件体验等要在实现前进一步核查当前 Profile 与真实 UI。

## 证据索引

Seal 路径相对 `D:/git-workspace/AI/seal-harness/`；Octop 路径相对 `D:/git-workspace/AI/newwork/Octop-Enterprise/`。

- S1：`seal-harness-desktop/cordis.patch.yml`，实际产品插件、会话搜索、终端/工作流/STT/浏览器/团队装配。
- S2：`.trellis/spec/general/desktop-build.md`，当前导航、数据、身份边界、双任务系统和已移除插件；`docs/seal-harness/migration.md`，移除历史。
- S3：`seal-harness-desktop/plugins/experts/src/panel.jsx:107` 系统空态；`experts/src/module.js` 个人专家持久化、版本及 Agent preset 注册。
- S4：`.trellis/spec/general/capability-catalog.md`；`seal-harness-desktop/README.md`，目录、安装、依赖与许可边界。
- S5：`deepseek-harness/docs/user/guide/mcp-memory.zh.md`，默认关闭的记忆参考配置与 DSH 职责。
- S6：`seal-harness-desktop/plugins/navigation/src/client.jsx:85` 自动化指向原生 schedules，`:112` 空间空态。
- S7：`.trellis/spec/general/desktop-build.md` 的定时任务契约；`seal-harness-desktop/plugins/scheduled-tasks/`。
- S8：`seal-harness-desktop/plugins/image-generation/src/index.js`，ImageGen/ImageEdit 与配置 RPC。
- S9：`seal-harness-desktop/plugins/identity/src/local-service.js`，首次管理员、本地登录与内存会话；`identity/src/index.js` RPC。
- O1：`docs/enterprise-client.md`；`docs/user-guide.md`，实际员工本机能力和限制。
- O2：`dashboard/src/routes/index.tsx`，当前功能入口；`src/octop/api/routers/`，HTTP 能力目录。入口存在本身不作为运行成功证据。
- O3：`src/octop/api/routers/experts.py:1` 模板/市场说明，`:483` 发布模板列表及后续安装/管理。
- O4：`src/octop/api/routers/knowledge_bases.py:519` 起的库/文档/目录/索引接口，检索范围见 O1。
- O5：`src/octop/api/routers/memory.py:1` 接口说明；`memory_portable.py:98` 起的来源/打包/采用/诊断。
- O6：`dashboard/src/pages/Messaging/ForwardDialog.tsx`、`forwardDelivery.ts` 与测试；`dashboard/src/pages/Chat/utils/localArtifactTurns.ts`；操作语义见 O1。
- O7：`src/octop/api/routers/cron.py`；`src/octop/infra/cron/{manager,job,delivery}.py`。
- O8：`src/octop/api/routers/voice.py:113` STT、`:134` TTS；`dashboard/src/context/VoiceOutputContext.tsx`。
- O9：`src/octop/api/routers/media_generation.py` 企业媒体配置；`README_CN.md`/O1 的本机媒体说明。
- O10：`src/octop/api/routers/browser/record_replay.py:1`，依赖探测与录制/回放路由。
- O11：`src/octop/api/routers/communication.py`；`services/communication/README.md`；O1 的通信与转发说明。
- O12：`src/octop/infra/users/permissions.py`；`src/octop/api/routers/{user_roles,users,auth_oidc,auth_ldap}.py`；`src/octop/infra/auth/`。
- O13：`src/octop/api/routers/client_config.py:22` 通知与后续 status/publish；O1 配置刷新说明。
- O14：`src/octop/api/routers/usage.py:194` 汇总及导出；`observability.py:52` 起的配置/测试；审计入口见 O2。
- O15：`src/octop/api/routers/backup.py:213` 起的备份列表/自动备份/导出导入/恢复；设备补传边界见 O1。

## 本轮验证与环境

- 初始 Seal Git 工作区干净；Octop 仅见未跟踪 `.codegraph/`，未写 Octop 文件。
- 默认 Node 16 下 `trellis --version` 失败于 `ReadableStream is not defined`；使用 Codex 已带的 Node 可执行文件直接运行已安装 Trellis，成功输出 `0.6.17`。没有修改系统 Node、依赖或项目模板。
- 系统没有 `python` 命令，使用 `py` 执行仓库脚本成功；开发者为 codex，当前无会话任务后创建本任务。
- 本轮只新增计划资料，不执行产品 build/check；所有“已装配”结论不冒充真实运行验收。
