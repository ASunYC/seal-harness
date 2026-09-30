# Seal Harness 迁移记录

2026-09-29 从用户提供的 `zhizuo-master.zip` 迁入当前空仓库。ZIP 包含 DSH Desktop 的下游源码，但没有 Git 元数据或子模块 gitlink。本次从 `upstream.json` 的 Beta 通道读取 `00102833dfaee1da9f48a3a8eae9d34005a75218` 作为 `deepseek-harness/` 固定提交，并通过 GitHub API 确认该提交存在。

## 保留的机制

- 根仓库沿用 Yarn 4 工作区及 Stable、Beta、Next 桌面包。Beta 负责当前产品构建，Stable 和 Next 保持上游职责。
- `deepseek-harness/` 继续是只读子模块；`vendor/dsh-runtime/` 提供固定上游运行时包。产品代码不复制 Harness 内核。
- `seal-harness-desktop/` 为非 workspace 产品包，`scripts/build.mjs` 编译品牌与业务插件，装配进 Beta Desktop，`cordis.patch.yml` 组合 Profile。
- Electron Host 在启动前读取 `product.json`，统一应用 ID、名称、数据目录、图标和安装器。显式 `DSH_HOME` 仍覆盖默认 Home。
- 未配置 Seal Harness 更新服务时，禁用 DSH Desktop 社区更新请求和入口。

## 品牌迁移

产品目录、包名、Cordis 服务名、RPC 路径、构建命令、窗口文案、安装器名称、协议与默认 Home 改为 Seal Harness。`@seal-harness/*` 是产品插件命名空间；`@deepseek-ai/*`、`dsh-*` 与第三方网络服务地址仍保持其实际来源和协议。旧产品 Home 不会自动迁移或删除。

新海豹原图保存在 `seal-harness-desktop/assets/app-icon.png`，由 `scripts/export-product-icons.py` 导出 Windows ICO、macOS ICNS、Linux PNG、托盘以及界面所需尺寸。`icon-provenance.json` 保存每个资源的 SHA256。产品资源由 Git LFS 跟踪。根 README 已改为 Seal Harness 入口，旧上游来源与许可证保留。

## 验证

以 [`validation.md`](validation.md) 记录本次实际检查。ZIP 里的旧验收日志不作为 Seal Harness 的验证证据。Windows/macOS/Linux 的打包、安装和升级必须分别在目标平台进行。

2026-09-30 更新目录的功能差异及品牌保留范围见 [`source-update-2026-09-30.md`](source-update-2026-09-30.md)。
