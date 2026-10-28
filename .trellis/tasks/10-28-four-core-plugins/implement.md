# 实施与分工

1. [x] Token 子智能体：独占 `plugins/token-stats/`，调研并实现真实用量统计，提供 schema 和接口需求。
2. [x] 知识库子智能体：独占 `plugins/knowledge/` 与必要的 `plugins/weknora/` 扩展，复用连接并实现管理/检索。
3. [x] 远程桌面子智能体：独占 `plugins/remote-desktop/`，实现就绪检查、截图/控制会话与页面。
4. [x] ACP 子智能体：独占 `plugins/acp/`，实现 Runner 配置和真实协议路径。并发槽位只有三个子智能体，首个完成后派发第四块。
5. [x] 主智能体：导航 `primary` 注册、图标/顺序、产品构建/Profile、local-data 合并迁移、总规范。
6. [x] 模块各自完成单元/RPC/UI测试；主智能体交叉审查身份、凭据、生命周期和假成功路径。
7. [x] 串行运行 `desktop.mjs build/check`，检查真实 Profile 和 Windows 全部一级页面，实际能力探测并记录依赖未就绪项。

不提交或推送。构建共享产物仅由主智能体执行，子智能体用 Node 24、已有 Beta 工具链跑模块定向测试，避免同时重建整套产品。外部服务/真实模型测试避免无必要计费，不输出密钥或用户文档。

## 当前进展

已完成四模块集成、完整check及终版构建/Profile/Windows冒烟。终版进程31976保持运行，最后回首页；无提交或推送。完整交付证据及未验证依赖以 `validation.md` 为准。下方为实施过程记录。

- token_stats 子智能体已完成，8项测试通过；knowledge已完成，12项测试通过；remote_desktop两次交付共17项通过（追加显式连接和失败草稿回归）。知识库子智能体另完成只读交叉审查 token/remote，18项测试通过，无新确认阻断；见 research/cross-review.md。
- acp 子智能体 `/root/acp` 正在实现/测试。父审查已发送两项修复要求：同Runner修改/停用/删除与launch交错的竞态；cleanupFailed后不得释放未知进程占用并重新启动。
- 父已加入primary导航及四图标，导航2项测试通过；local-data v7（token_usage_turns、acp_runners）及旧数据库迁移测试通过，连带apps共13项通过。现有实际v6数据库备份在忽略目录 `.build/four-core-before-migration.sqlite`。
- build.mjs、desktop.mjs、产品patch已登记四模块；Host外置koffi与SDK；verify.mjs允许新knowledge。尚未运行四模块完整产品构建（等待ACP完成）。
- 本机WeKnora loopback health不可达，Docker引擎未运行，已知WeKnora checkout不存在；不伪报远端联通。不部署服务、不输出已有凭据。remote只读Windows截图成功，未做真实输入。ACP后续需真实受控fixture协议测试，不消耗第三方账号模型额度。
- 当前main有前两任务（反馈移除、导航布局）未提交改动，必须保留。实际Electron上一版进程20320，CDP端口9335；运行四模块前需完整build，再精确停止该产品进程并用 `.build/launch-current-seal.mjs` 重启。Node24完整路径见各模块记录，默认系统Node16不适用。
