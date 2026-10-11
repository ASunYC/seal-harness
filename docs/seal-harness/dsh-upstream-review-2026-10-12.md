# DSH Desktop 近期更新评估（2026-10-12）

## 比较基线

- 本地独立抓取：`dsh-upstream/master` = `7abe94dd037450f8ebaae71d938b8dad2f125610`，对应最新 Beta `2.0.17-beta.2`；未合并到 Seal Harness 工作分支。
- 上游历史基线：`v2.0.14-beta.1` = `84946e2abec910b60e1f5f8aa69e45ab34df2a04`。Beta 目录从该基线到最新 master 涉及 116 个文件，约 4,369 行新增、948 行删除。
- 当前 Seal Harness 的 Beta Desktop 包号仍是 `2.0.14-beta.1`，但产品发布版本独立为 `0.1.0`。当前固定的 DeepSeek Harness 内核是 `0.1.7-alpha.2`；历史上游基线的内核已是 `0.1.7-rc.1`，最新 master 的 Beta 通道是 `0.2.1-alpha.2`。单纯比较 Desktop 版本号不足以保证内核兼容。

上游 [Beta 2.0.17-beta.2 发布记录](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.17-beta.2)介绍了开发者日志、启动诊断、便携版与 Linux ARM64、沙箱命令、插件信息和局域网访问等更新。下面按本仓库的产品边界区分移植顺序；“可移植”表示值得单独实施和测试，不表示代码可以直接整树合并。

| 优先级 | 更新与上游提交 | Seal Harness 适配判断 |
| --- | --- | --- |
| 高 | [安全清理旧 Profile 链接投影](https://github.com/anywhere-labs/dsh-desktop/commit/e6e800bd) | 当前 `profile.ts` 仍调用旧 `removeLinkProjections`。上游指出 Electron 44 下递归清理 junction 可能触及旧安装目录；值得优先按独立补丁迁入 Beta/Stable 并做真实 Windows junction 测试。与产品 SQLite 无直接关系。 |
| 中 | [Windows ACL 沙箱命令不弹控制台](https://github.com/anywhere-labs/dsh-desktop/commit/69ed0b12) | 当前仍有旧 `windows-console-host.ts`；可独立移植，但需要 Windows 版本兼容及沙箱执行回归。 |
| 中 | [Linux AppImage 应用内重启](https://github.com/anywhere-labs/dsh-desktop/commit/a39574fd) | 当前 `main.ts` 仍调用 `app.relaunch`；如果发行 AppImage，值得单独移植并在 AppImage 与无 FUSE 模式实测。 |
| 中 | [macOS 麦克风权限与签名 entitlement](https://github.com/anywhere-labs/dsh-desktop/commit/8101ff14) | 语音/录音场景有价值，需同时迁入代码、entitlement 与发布检查；必须在签名 macOS 包上验证。 |
| 中 | [macOS 工作目录系统选择器](https://github.com/anywhere-labs/dsh-desktop/commit/86914c71) | 当前仍使用旧选择流程；可单独评估，验收依赖 macOS 图形测试。 |
| 中低 | [开发者诊断日志与启动追踪](https://github.com/anywhere-labs/dsh-desktop/commit/8383d654) | 对定位当前桌面问题有价值，但跨 Host、渲染器和诊断导出多层，部分使用新版内核检查 API，应在先确认内核升级路线后单独设计。 |
| 待内核升级 | [官方插件包服务](https://github.com/anywhere-labs/dsh-desktop/commit/960bddea) | 最新上游为新版插件管理提供服务；Seal Harness 当前内核仍是 `0.1.7-alpha.2`，不能直接搬该契约。 |
| 不纳入当前 Beta | Next 专属 Inspector、下载、Windows 标题按钮和 Next 更新修复 | 当前产品由 Beta Desktop 承载，Next 专属变更无直接作用。 |

上游 2.0.15–2.0.17 的首次引导、登录衔接和更新下载也发生变化，但 Seal Harness 已有独立本地登录并关闭社区 Desktop 更新渠道，不能原样照搬。上游新增 Windows 便携包与 Linux ARM64 包属于分发范围扩展，不应与普通 Desktop 行为补丁混成一个提交。

## 建议实施顺序

1. 单独处理旧 Profile junction 清理的安全修复，先确认本机是否存在旧投影，再跑 Stable/Beta 双变体和 Windows 文件安全测试。
2. 按实际发行平台选择 Windows 控制台、Linux AppImage、macOS 麦克风/目录选择器的独立补丁。每项分别记录构建、启动、安装和回归结果。
3. 规划 DeepSeek Harness 内核从 `0.1.7-alpha.2` 升级到新版的兼容矩阵后，再考虑插件包服务、开发者日志与整版 Desktop 同步。子模块 pin 更新必须单独提交，不与产品行为混合。
