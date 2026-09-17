# Seal Harness 桌面版

桌面版使用 Electron + electron-builder 打包，内置独立 Node.js 运行时与 Seal 后台。
它复用现有 Web 界面，PI Agent 仍是 Seal 唯一 Agent 内核；原有 Web / CLI 启动方式保留。
此版本目前是本地候选产物，不代表已经上传 GitHub Release。

## 在 VS Code 中开发

仓库根目录运行：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm desktop:dev
```

该命令构建 Web 及其依赖，然后打开独立桌面窗口，不是打开系统浏览器。
开发启动需要项目要求的 Node.js 和 pnpm；发布产物已内置运行时，不要求最终用户安装它们。
当前没有桌面源码热更新承诺，修改后重新执行启动命令。

## Windows 产物

执行 `pnpm desktop:dist` 后在 `.artifacts/desktop` 查找：

| 文件 | 用途 |
| --- | --- |
| `Seal-Harness-Portable-0.3.4.exe` | 免安装、单文件入口，双击启动 |
| `Seal-Harness-Setup-0.3.4.exe` | NSIS 安装向导，可选择安装位置 |
| `win-unpacked/Seal Harness.exe` | 解压目录版，必须保留整个目录，不能只复制此 exe |

便携 exe 启动时会将程序资源释放到 Windows 临时目录下的运行目录。
Windows 临时目录通常是 `%LOCALAPPDATA%\Temp`，实际位置取决于系统 `TEMP` / `TMP` 配置。
“单文件”指分发入口，不表示运行时绝不释放文件，也不表示用户数据随 exe 携带。
首次启动可能因解压和安全扫描较慢。

候选程序尚未进行可信代码签名，Windows 可能显示安全信誉提示；不要据此关闭系统防护。
正式分发前仍需完成签名方案、安装/卸载和普通可见窗口回归。

## 数据位置与升级

桌面版的持久数据默认位于：

- Windows：`C:\Users\<用户名>\.seal-harness`
- Linux：`~/.seal-harness`
- Electron 窗口缓存和用户状态：上述目录中的 `desktop` 子目录

模型凭据、会话等后台数据与临时解包资源分离。此目录可能包含敏感信息，请勿公开上传。
工作区源文件仍在用户选择的项目目录，不会搬进 `.seal-harness`。
开发模式默认也使用这个用户数据目录，不是一次性演示数据。

升级或备份前完全退出桌面应用，再备份 `.seal-harness`；工作区文件需要另外备份。
替换便携 exe 不需要删除用户数据。不要把清空 `.seal-harness` 当作常规升级步骤。
原有 Web / CLI 的工作区本地数据不会自动迁移到桌面用户目录，当前不要手工混合两套会话目录。

## Linux

在 Linux 上执行相同的 `pnpm desktop:dist`，目标为 `Seal-Harness-0.3.4-<架构>.AppImage`。
不能把 Windows 打包通过视作 Linux 可用的证据；当前 Linux AppImage 尚待构建与实机验收。
无图形桌面的 Linux 服务器继续使用原有 CLI / Web 入口。

Linux x64 的 CI 现配置源码与 AppImage 实际启动检查：

```sh
xvfb-run -a pnpm desktop:verify
pnpm desktop:dist
xvfb-run -a pnpm desktop:verify:packaged
```

成品检查运行 AppImage 的工具、子会话和长历史场景，并核对前后端资源及二进制指纹。
CI 使用 `APPIMAGE_EXTRACT_AND_RUN=1`，不要求 FUSE 挂载；这是
[AppImage 官方的解包运行方式](https://docs.appimage.org/user-guide/troubleshooting/fuse.html#extract-and-run-type-2-appimages)，不等同于普通桌面的挂载启动验收。
检查不会添加 `--no-sandbox`。需要图形运行依赖和可工作的 Electron sandbox；若缺失，应修复测试环境，不能将构建成功当作启动通过。
目前仅接入 x64 成品检查，尚无 Linux 成功运行报告，ARM64 尚未验收。

## 自动验证与发布边界

```sh
# 构建源码并依次检查浅色/深色 PI 写入回退、取消并重开、失败后恢复、shell 实时输出及中断、长会话、子会话、工具卡片
pnpm desktop:verify

# Windows 完整打包后，分别检查目录版和便携单文件中的工具、子会话与长会话
pnpm desktop:verify:packaged
```

每个场景使用独立临时工作区；前一场景的环境标记不会泄漏到下一场景。
打包版执行六个场景：两种产物各自验证工具卡片、子会话详情及 80 回合历史窗口。
这些场景使用受控数据，不调用收费模型，也不读取用户会话；打包版不运行源码专用的 PI 流式写入夹具。
结果和截图位于 `.artifacts/desktop-verification/source` 或 `packaged`。
JSON 报告只有所有场景通过才标记 `completed: true`；失败会中断命令并保留已完成项。
源码夹具验证不代表安装/卸载已通过，打包版启动也不代表包内所有功能已验收。
当前仅 Windows CI 执行这些桌面验收，Linux 图形环境仍需另行验证。

`.github/workflows/desktop.yml` 提供手动构建工作流，产物上传为 Actions artifacts，
不自动创建 GitHub Release，不自动发布给最终用户。
桌面窗口只连接本机后台；启动时自动完成认证交换，用户不需要复制 token。
关闭最后一个窗口会退出应用并请求后台关闭，重复启动会聚焦已有窗口。

具体功能验收及尚未补齐的事项以 [PI-Desktop 对齐记录](pi-desktop-alignment.md) 为准。
