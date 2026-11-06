# BuildingBuilt 独立桌面应用接入

## Goal

独立 Windows 发布包、本地校验安装与 Seal 应用入口，不增加 Seal 安装包体积

## Requirements

- BuildingBuilt 是独立桌面应用，保留 GIS/OSM → 模型 → Open 切片 → 本地 3D Tiles 主流程，并提供独立窗口和 CLI。
- Windows x64 发布物包含所需 Python/Node 运行时、模型资源和切片程序，脱离源码目录和开发虚拟环境可用。
- 发布包单独分发；Seal 安装包不包含该大体积发布物。当前无 Git 仓库或在线下载页，因此首版由用户选择已解压的本地发布目录。
- Seal 固定 BuildingBuilt 版本和发布清单摘要，逐文件校验后安装到当前账号的受管理目录，独立启动，卸载保留任务和配置。
- DBX 下载和 MCP 接入保持现状；不修改 workshop 原始参考工程。

## Acceptance Criteria

- [x] Windows x64 发布目录和可分发 ZIP 生成，含固定清单；发布物可脱离源码启动独立窗口并运行样本建模、切片。
- [x] Seal 应用页展示 BuildingBuilt，本地安装、打开、卸载、账号隔离、数据保留与校验失败行为通过验证。
- [x] Seal 安装包不携带 BuildingBuilt 的模型/运行时；DBX 原流程回归通过。
- [x] 文档明确独立发布、清单固定、支持平台和未验证项；不声称跨平台或模型 API Key 联调已完成。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
