# 本次实施记录

2026-11-03：读取两仓库状态和工程规范；两者 HEAD 均为 84d5766ab60a2ef12ff66919384ff9ed861d1e0d。Seal 分支 codex/upgrade-dsh-rc5-univer；AE 分支 feat/ae-hospital；两者内核 checkout 均为 b830ec950faba0a46dda564be3e2d854afed94f1。已有升级及 AE 品牌改动保留。未重建 AE Git。

远程只读核对：Seal origin 为 https://github.com/ASunYC/seal-harness.git；GitHub 元数据与 git ls-remote --symref origin HEAD 均确认 main，远程 HEAD 仍为 84d5766ab60a2ef12ff66919384ff9ed861d1e0d。AE origin fetch 指本机 Seal，push 保持 no-push://seal-harness-source。未 fetch/merge/push，未核实分支保护/required checks，不能宣称可直接推主分支。

GitHub 已连接身份 ASunYC；当前连接返回组织 []、安装账号 []，已安装仓库搜索 AE-Hospital 返回 []。普通仓库搜索超时；不能因此推断网上不存在仓库，也未确认用户提及 Labs 候选。未创建远程仓库、未上传代码。

工具链：系统 Node 16.17.0 与仓库要求不兼容；现有本机 Node 24.22.1 可用，Trellis 0.6.17 可用，未安装或更改系统版本。默认沙箱读取工具链遇到 EPERM；获准使用 require_escalated 后已可运行，非未解决的审批阻塞。

实际本次检查：使用明确的 Node 24 执行 corepack.js yarn seal-harness:check，退出 1。前段 ask-jev 相关测试通过；product.test.mjs:24 的 Stable/Beta Electron 插件元信息检查在 Stable electron.exe spawnSync 15 秒截止返回 ETIMEDOUT。后续产品插件/verify/verify-profile 未执行到。日志：C:/Users/Administrator/Documents/Codex/2026-11-03/task-3/seal-current-check.log。未改超时，未把检查失败当通过。

未运行 AE 检查、隔离新装、Word/PPT/Sheet 新验收、安装器/签名/升级或跨平台验证。未建立可交付安装包，未做代码提交或推送，未动其他项目/stash。新建本任务规划与证据文件，保留为未完成任务。

后续顺序：澄清 Office Pro 随两个品牌再分发及到期维护 -> 固定依赖/装配/许可通知 -> 修复并重测现有 Electron 基线失败 -> 两产品 build/check -> 产物/隔离安装/Office 实测 -> 分阶段提交 -> 核实主分支保护及 CI -> 仅 Seal 合并和推送。

## 继续实施阶段（2026-11-03）

用户已确认没有取得任何 Univer/Pro 单独授权。依据后续委派，继续许可来源无关的机制和测试；完整功能映射见 office-license-map.md。未复制真实 Office 运行时或许可，未购买、联系销售或改变产品能力目标。

已实现两品牌产品层 office-bundle.mjs：固定包版本/源码提交/根锁文件来源；拒绝工程外 profile 来源；仅装配发布 payload 及运行依赖，排除根私有配置；先验证暂存目录再可回滚切换；生成禁用遥测的产品 patch，不改用户 Home。分发入口与 electron-builder/产物检查已接入；修复原产品文件筛选漏带 THIRD_PARTY_NOTICES.md 的问题。只有分发命令装配 Office；普通开发构建维持当前基线。根依赖尚未加入，分发会明确阻塞，不能把该阶段代码称为完成安装版。

新增合成测试（每品牌3项）验证重复装配、patch去重、用户数据保持、缺依赖保留旧装配、错误版本/提交和外部链接拒绝；不包含第三方运行时或许可。两品牌均通过。Seal 产品身份与装配测试合计17项通过。

首次 Electron 15秒元信息超时未再次复现；直接最小探针 Stable 90ms、Beta 607ms 成功，原始脚本返回 resolver-ready。没有放宽门禁、修改测试截止或声称已定位根因。保留原测试重跑 Seal 完整 check 退出0，真实 Electron standard 会话和24个浏览器MCP工具、Creator、插件管理器与两轮HMR通过；日志 seal-check-retry.log。AE 完整 ae-hospital:check 同样退出0并通过上述Profile检查；日志 hospital-check.log。后续新增根锁文件检查后，两品牌合成测试再次通过。

尚未运行本轮 build、真实 Office 操作新验收、安装器/升级/跨平台；没有真实 Office 随包产物。主分支推送门禁仍未满足，不推送。

## 本次末状态

Seal 当前产品构建退出0，见 task-3/seal-build.log。AE 首次构建子命令误用了系统 Node16，虽然外层返回0但日志含 Usage Error，不能算通过；使用兼容 Corepack shim 重跑后完整编译退出0，见 hospital-build-retry.log。未更改系统默认 Node。

额外合成组合检查发现：composeEntries 对两个相同 univer insert 会返回两条。现有用户已通过 Profile 安装 Office 时，候选产品静态 insert 可能产生重复装配，不能声称已有Profile升级已验证。需要在真正安装前完善“产品默认 bundle 与用户 bundle 只装一次”的公开接入及回归；不通过删除用户Profile条目规避。此为候选代码尚未完成的技术项，与许可阻塞分开记录。

本轮源代码及文档已暂存供审查，但尚未提交。AE 现有品牌修改仍未提交；本轮对三个既有脚本仅将任务增量从原HEAD生成到索引，未把已有品牌差异混入暂存。所有原改动保留、无stash、无合并、无推送。真实Office依赖未加入根manifest/lock，无真实随包产物。候选代码不得当成完整交付或推送主分支。

## 独立保护机制收尾

已修复默认 Office 与用户已有 bundle 重复插入：Stable/Beta 的 product-bundle-defaults.ts 在组合前让产品默认 insert 让位于用户 bundle、手工插入及有效禁用状态；不改用户文件，保留显式遥测选择，沿用框架 config 整段替换语义。新增磁盘 Profile 回归覆盖重复启动、配置损坏明确失败、修复后恢复以及manifest/patch/数据原字节保留。两仓库、两变体各64项 Profile 测试通过。产品装配合成测试现4项，缺失/未锁定依赖不写可用配置，失败后可重试。

本轮最终产品构建与完整产品检查：Seal、AE 均退出0，包含真实Electron standard会话、24个浏览器工具、Creator、插件管理器与两轮HMR。AE两变体类型检查均退出0；Seal两变体完整包check到达unit test阶段，前面的build/typecheck通过。本轮没有生成含真实Office的安装包。

完整门禁不能报告通过：Beta包完整单测1560通过、24失败、13跳过；Stable包1578通过、25失败、13跳过。失败证据包括Windows文件symlink返回EPERM；Beta包版本集合断言1324对1942（既有rc5/旧版本resolutions共存）；原库存provider测试ctx.logger缺失导致warn异常；Stable的fs-ext清单写ABI148但已安装Electron实际ABI149；还有Linux产物fixture路径和Host/日志超时。相应main、运行环境、包测试和ABI清单均非本轮修改路径。未通过更改系统设置、删除测试或放宽门禁规避失败。日志：beta-full-check.log、stable-full-check.log。

README阻塞已按流程修复：读取并对照现有中文与英文，补齐知识库、计划任务、Token/远程主机/ACP和系统目录说明；医院版补齐已有品牌前缀译文，再更新实际Git blob哈希。两仓库52组/104份双语文档一致性通过。独立文档本地提交Seal cec3bbf3、AE 512c015；AE中文只含已确认品牌前缀及保留上游说明，无其他原源码改动混入。

layout重跑继续验证vendored runtime（Stable318包、Beta344包）、变体与图标后，被既有未暂存子模块pin阻断：index为687f282e，工作树及upstream.json要求b830ec95；子模块自身无未提交源码。未为通过检查而改动校验规则或擅自把此旧升级改动混入独立机制提交。后续整包交付仍需单独完成内核升级阶段提交及全部门禁修复。

规范追加脚本曾因PowerShell到Python管道编码异常截断Seal的desktop-build.md；已立即从未受影响的AE对应段核对恢复，恢复后相对HEAD差异精确回到会话开始已有3增1删，再采用UTF8文件和原子替换追加本轮章节。新增章节只暂存本轮契约，原rc5规范变更保留未提交。

暂存内容凭据格式扫描通过，只包含源码/测试/规范/任务记录，不含tgz、node、exe、数据库或真实Office许可。整体任务仍in_progress，不归档、不push、不发布Release；许可与最终真实Office安装验收待用户决定。

隔离诊断重跑：Stable原失败Host测试在较小测试集合中3项通过（agent错误日志及AA开/关独立Host），日志容量/轮转测试仍在原10秒门禁超时。未提高截止、修改系统安全设置或将隔离诊断当整套通过。原始完整包统计仍按24/25失败如实保留；日志stable-timeout-isolated.log。全部已启动检查已收尾，无遗留测试进程等待。

本地检查点只保存独立的默认插件/装配保护及其回归；完整产品交付、内核升级提交、跨平台及商业Office验收尚未完成，不能标注整体门禁通过。

## 原内核升级门禁修复阶段进展

已按授权单独提交原内核pin：Seal 53399025，AE 04a397f；子模块源码未改。正常Yarn安装及immutable均通过；两仓库完整check:layout现均退出0，验证Stable318包、Beta344包、203共享源码、图标及b830ec95来源。AE曾因子模块origin仍指本地克隆源而失败，已按.gitmodules执行git submodule sync恢复官方origin，顶层no-push配置不变。

已修复但尚未提交的升级收敛项：原生清单统一读取已安装Electron的ABI149，替代Stable残留ABI148；rc5 web-app实际使用open ^11.0.2，此前未命中11.0.1补丁，新增11.0.4同版本windowsHide补丁并由正常Yarn更新锁文件；Beta库存回归按rc5真实契约校验告警省略及name-only身份，同时保留可读包和不执行插件的断言；版本集合加入实际存在的Next 0.1.7-alpha.2家族，未删除旧版本或放宽未知版本检查；修正旧测试对product setup wizard开关及Windows路径分隔符的假设。

日志轮转首轮只减少重复全文件读取后仍12.86秒失败；进一步把同一次状态切换的完成/开始事件同步成批持久化，不减少事件、不延迟落盘。原10秒容量测试及新代际替换保护测试共2项已在6.29秒通过。定向升级回归Beta146通过/1既有跳过，Stable144通过/1既有跳过，覆盖库存、包表面、ABI、native清单和chrome路径。

以上新修复尚待完整类型/产品重建及更广回归后再提交，不能当整体全部通过。此阶段已启动进程均已收尾。当前令牌whoami /priv未列SeCreateSymbolicLinkPrivilege，文件symlink的EPERM需要具备许可的执行环境（或由用户决定系统Developer Mode等设置）；未改设置、未反复重试。官方参考：https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw 。真实Pro分发仍等待许可路线，不打包、不push。

## 2026-11-03 最终升级修复与交付边界

本轮实际执行结果（覆盖前文旧基线统计）：两仓不可变安装及完整 layout 通过，344 个 rc5 npm 归档与 AA 归档逐个 SHA256 匹配记录；新增 Pro/Office 依赖为零。rc5 市场所需 plugin-manager 显式运行依赖已补齐，Stable/Beta 运行闭包与许可检查通过。type-fest 的精确双许可证表达式 (MIT OR CC0-1.0) 两项均在既有允许范围，不改变商业组件检查。

两产品最新 build/check 均退出 0（医院版补齐闭包后再次重建/检查也通过），实际 Electron standard 会话 24 个 browser MCP 工具、Creator/plugin-manager 和两次 Profile HMR 通过。这是基础产品和合成 Office 组合验证，不是带真实 Office 的新机器安装验收。

完整单元回归：Beta 1569 通过 /16 失败 /13 跳过；Stable 1587 通过 /17 失败 /13 跳过。日志容量/轮转在原 10 秒门禁内通过，两通道仅剩的 lifecycle 失败均为文件 symlink 建立 EPERM。Beta 一项旧图标断言随后修复并针对性 2/2 通过；没有重写上述整套统计为全通过。其余失败：每通道 9 项 symlink 权限失败，Beta 5 项 /Stable 7 项 Linux 制品 fixture/执行位假设，以及每通道 1 项 Linux PATH 模拟使用 Windows 盘符。未删除/跳过这些测试；未改变 Windows 系统设置或申请安全特权。whoami /priv 无 SeCreateSymbolicLinkPrivilege，需具备该能力或按系统正式配置允许非特权 symlink 的执行环境；本任务未授权改变该设置。Linux 制品应在 Linux 环境实际复核。

根完整 check 停在 Market 既有界面文案断言：285 通过 /1 失败，期望的固定句子缺少界面已有的重试提示后缀。该文件本次未改，不能声称根门禁通过。Stable/Beta 类型、构建已分别在完整 workspace check 中先行通过；独立完成被单元阶段阻断的闭包、CLI、Loader、Profile、AA、license、operations 验证并记录各自真实结果。

CLI 冒烟原先隐含读取真实用户 Profile，并把 Windows 私有批处理入口当 POSIX 路径/环境。现改为自建临时 Profile、显式 DSH_HOME；标准化 bin/.. 路径，Windows 私有 Electron 后代保留 Node 模式的断言遵循现有实现。公开入口环境隔离断言仍保留，未修改运行时环境/用户数据。两通道隔离 CLI 已通过。

不产出或分发含未授权 Univer Pro 的安装包，不合并或 push 主分支，不发布 Release。Office 商业授权/合法开源功能路线等待用户决定；AE 远程目标与公开性尚未确认，既有 no-push 保持。任务维持 in_progress，保留原业务/品牌源码变动，不归档。

证据日志位于 C:/Users/Administrator/Documents/Codex/2026-11-03/task-3：upgrade-root-final.log、upgrade-beta-final.log、upgrade-stable-final.log、upgrade-focused-*-final.log、upgrade-*-verify-*.log、dsh-plugin-desktop*-final-*.log、dsh-plugin-desktop*-isolated-cli.log、upgrade-seal-build-final.log、upgrade-seal-product-final.log、hospital-rebuild-closure.log、hospital-recheck-closure.log、upgrade-types-final.log、hospital-types-last.log。后续最终类型/运行门禁结果以实际进程退出码和日志为准。
