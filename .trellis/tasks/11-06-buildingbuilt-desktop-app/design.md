# 设计

BuildingBuilt 负责自身桌面主进程、本地回环 Web 服务、GIS/建模/切片代码、Pi 会话与输出。Windows 版以 PyInstaller 单目录发布，资源和 Node/Pi 运行时与 exe 同目录，数据通过 `BUILDING_BUILT_DATA_DIR` 指向 Seal 当前账号的数据目录。窗口仅由 BuildingBuilt 创建；Seal 应用页不是业务界面。

发布目录含 `release.json`，声明应用 ID、版本、Windows x64、入口和逐文件 SHA-256。Seal 目录固定该清单的 SHA-256，不接受客户端指定下载 URL、可执行文件或额外启动参数。用户给出的本地目录仅作为安装输入，安装器校验后复制到 `applications/<账号哈希>/buildingbuilt/runtime`；数据在相邻 `data`，卸载不清理。后续如提供自有制品地址，复用同一可信清单，不影响 Seal 安装包体积。

Seal 的 `@seal-harness/apps` 保留现有 DBX 服务，另有 BuildingBuilt 专用生命周期服务。两者共同列在应用页，按 ID 路由现有 RPC。BuildingBuilt 不接入 MCP。启动前校验 exe 哈希、核对同名进程路径；独立进程以当前账号 data 为 cwd，使用随机就绪 nonce 识别窗口已显示。回环接口使用随机端口与会话令牌，避免其他本机页面直接调用。

更新采用先校验和复制到 staging，再替换 runtime；失败时保留旧版。当前固定 0.1.0，暂不提供在线升级入口。Windows x64 是唯一发布平台；Linux 源码运行不等于独立应用验收。
