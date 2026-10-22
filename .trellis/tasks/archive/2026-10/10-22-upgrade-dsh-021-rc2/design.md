# 实施边界

根 upstream.json 描述 Stable/Beta 两套运行时；Seal Harness 复用 Beta。通过现有 upstream:prepare-runtime 与 sync-vendored-runtime.mjs 生成官方包、SHA256 清单、版本选择和依赖。只在未能获得官方发布包时从固定源码使用官方构建链生成，不修改子模块源码。

预期变更为子模块 gitlink、upstream.json、vendor/dsh-runtime/0.2.1-rc.2、根 resolutions/锁文件、Beta/Market manifests、产品插件 peerDependencies、必要的版本专用补丁及验证文档。共享 Desktop 接口有真实差异时才 Beta 先适配再镜像 Stable；Next 保持原 pin。

先比较发布 tag 与现有提交的 API、框架和依赖变化；复用已有公开扩展。子模块 pin 作为独立提交；运行时升级与必要适配按可验证阶段保留回滚点。用户数据与现有 Profile 不迁移或删除。

官方 npm 已发布 rc.2 的完整 343 包，使用与固定 tag 对应的公开发布集合，逐包校验 npm SRI，再保存原始 tarball 与 SHA256 清单；不另行构建修改内核。22 份已有下游补丁移植到 rc.2，发生结构变化的 app-boot、插件管理页和桌面引导页人工核对，保留新增上游菜单和属性。

AA 的 `runtimePeers` 是实际版本门禁的一部分，必须适配新的 Beta 版本。本轮使用已有 AA 源提交 7fe1fce32650483bf8433f7a198032178580ff16 重新准备产物与来源，不顺带迁移 AA main 的功能；这不是安装包发布，发布前仍按既有契约刷新官方 AA main。
