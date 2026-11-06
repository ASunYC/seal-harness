# 实施与验证

1. 调整 BuildingBuilt 桌面入口、数据目录、子进程和本地接口认证；保持 CLI 与 Web 主流程。
2. 构建独立 Windows x64 发布目录，复制资源，生成逐文件清单及 ZIP；从发布物运行样本与窗口冒烟。
3. Seal 应用插件新增固定清单的本地目录安装、账号隔离、启动就绪和卸载；应用页展示独立安装入口。
4. 更新 BuildingBuilt README、Seal README 与应用规范；验证 DBX 回归、BuildingBuilt 安装回归、产品构建与检查。

验收记录（2026-11-06）：

- BuildingBuilt Windows x64 独立目录约 1.96 GiB（31,282 个文件），ZIP 1,279,706,336 字节；`release.json` SHA-256 为 `4d957909256e71a06d120cfbaa18f3b452fff1a845798664d31074e1d1ce8f9c`，已固定到 Seal 应用目录。ZIP 内清单与固定摘要一致。
- 冻结版从开发目录以默认 L3、显式 L4 两种层级生成 FBX 与 `tileset.json`，结果均为 `finished` 且无警告；从系统临时目录再次以默认 L3 运行完整样本成功。桌面窗口返回就绪信号；关闭后无残留 BuildingBuilt 进程。
- Seal 用真实发布目录完成逐文件安装校验，核对安装后的 exe，并清理了临时副本；小型回归覆盖摘要失败、篡改文件、替换失败回滚、打开/卸载、数据保留。应用测试 14 项通过、1 项既有 DBX 联机测试跳过；全量构建和 `seal-harness:check` 通过。
- 大体积模型资源与运行时只在 BuildingBuilt 发布目录及 ZIP 中；Seal 仅保留应用入口与摘要。PostGIS 实库、Pi 模型 API Key、Linux 发布物仍未在本任务验证。
