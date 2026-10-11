# 版本数据流与上游评估

当前原生 `electron-runtime.ts` 用承载包 `dsh-plugin-desktop-beta/package.json` 作为 `PRODUCT_VERSION`，客户端标题栏显示 `environment.version`，electron-builder 继承 Beta manifest 版本。产品自身 `seal-harness-desktop/package.json` 为 `0.1.0`。

构建入口读取产品包 manifest 的版本，传给 Desktop 构建配置作为可选自定义产品版本。原生运行时在定制构建下优先使用此版本，在未定制构建下继续读承载包版本。安装包配置的 `extraMetadata.version` 使用同一产品版本。校验版本格式、测试两个模式，并同步 Stable/Beta 共享实现。

上游以独立 `dsh-upstream/master` 引用读取；比较 Git 标记的 `v2.0.14-beta.1` 与 `v2.0.17-beta.2` 的 release notes、提交和涉及路径。把可带入的 bugfix 与需要 DSH `0.2.0-rc.2` 的升级拆开报告，不更改产品运行时 pin。
