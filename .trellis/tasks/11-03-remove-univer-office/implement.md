# Implementation

Current profiles each directly depend only on dsh-univer-office 0.3.9; installed node_modules inventories contain 2868 files, about 316MB, with no links, Office documents or databases. Private recoverable backup is being verified before removal. Dedicated office-bundle source/tests and assembly/verification hooks removed; generic safeguards retained with fake add-on. Existing AE business/brand changes preserved.

## 2026-11-03 实施与验证结果

用户明确改变方向并批准卸载删除 Univer Office。此前随包分发方案停止；此次不暂存、不自动提交、不推送、不发布。未重置历史或内核升级。

专用 office-bundle.mjs 及其测试删除，两产品 desktop/electron-builder/verify-package 中的专用导入、装配、依赖、payload 和 Office patch 校验移除。通用 product-bundle-defaults 防重复/尊重停用保护保留，其两变体测试改用 fixture-product-addon，未调用第三方插件。构建契约仅更新该章，前面的已有改动保留。根依赖/锁文件原本没有该插件，本次未修改它们。

两个真实 Profile 直接依赖都只有 dsh-univer-office 0.3.9。先核对安装目录无 junction/symlink、用户 Office 文档或数据库，随后在各自产品 Home 的 .uninstalled-plugins/univer-20261103-143312 保存完整安装及将修改的控制文件，每侧 2873 文件逐项 SHA256 验证。备份不在仓库/分发目录，不会自动加载。仅作为本次可恢复卸载副本保留；未清理共享包缓存或用户个人数据。

pnpm11.8 的 remove 不支持旧 --offline/--ignore-scripts 子命令参数，首次在删除文件前返回参数错误。按实际 CLI 验证 --config.offline=true 与 --config.ignore-scripts=true 都读回 true 后续做，两个卸载均退出 0，未运行插件卸载遥测脚本。精确移除依赖、dsh.profile.bundles 中该项和原尾部 id:univer 的 telemetry 覆盖。卸载后原 manifest 其他语义字段严格比对不变，锁文件不再含 Univer/Pro，node_modules 内遍历无 dsh-univer-office 或 @univerjs-pro 包。

Seal 的 cordis.yml 在备份后由 3 字节空占位文件并发生成约49KB配置；检测到变化后保存新旧副本，没有覆盖或清空生成文件。最终两侧 package.json/cordis.patch.yml/cordis.yml/pnpm-lock.yaml 均无活动 Office 引用。活动源码扫描无专用引用；历史研究、许可证映射和安装记录保留作审计，不表示当前功能。检查范围中的其他预先存在业务/品牌改动逐文件哈希未变化。未卸载通用 LibreOffice、DSH 或其他文档能力。

实际通过：四组（两仓xStable/Beta）Profile回归各64项；两仓完整 typecheck；Seal seal-harness:build/check 与 AE ae-hospital:build/check；两仓完整 check:layout；真实 electron-builder 配置的 dependencies/files 中无 Univer/Pro 专用依赖或 payload。产品检查含真实 Electron standard 会话、24 个 browser MCP 工具、Creator/plugin-manager、两轮 Profile HMR。未打包安装器或给客户部署。

初次验证误从工具工作目录执行，workspace 未找到，未进入产品检查；从正确仓库重跑后以上结果全部通过。没有重复运行已知 Windows symlink EPERM 的完整单元套件，也没有把历史完整根门禁的权限/平台失败称作已解决；本轮相关门禁已通过，不代表所有平台的完整根 check 通过。无新的用户许可决策阻塞本次移除。

日志在 C:/Users/Administrator/Documents/Codex/2026-11-03/task-3：remove-univer-{beta,stable}-profile.log、remove-univer-ae-{beta,stable}-profile.log、remove-univer-types.log、remove-univer-ae-types.log、remove-univer-seal-{build,check}.log、remove-univer-ae-{build,check}.log、remove-univer[-ae]-layout.log、remove-univer[-ae]-package-config.log、remove-univer-{seal-harness,ae-hospital}-pnpm.log。本机恢复及结果索引为 univer-backups.json、univer-removal-results.json；备份本身只在各自私有 Home。

实施已完成并通过本轮相关验证；保留未提交状态供用户审阅，任务不归档。

最后补充：pnpm 的 .modules.yaml（JSON 格式）仅在 skipped 数组留下8条未安装的Pro可选平台记录；先备份当前元数据，再只过滤这8项，其他字段逐项相等。两侧 pnpm list --depth 0 --json 确认无直接安装依赖，工作区/模块映射/虚拟锁元数据均无Office/Pro引用。
