# Seal Harness v0.3.1

通用 DSH 插件安装与 Web Client 兼容版本。

## 新增

- `seal-harness plugin add/remove/list/doctor/enable/disable`；
- 每个 Profile 独立的 package manifest、lockfile 与 node_modules；
- npm、本地目录及 GitHub `#path:` 插件来源；
- GitHub 子目录 partial clone，只下载插件运行时文件；
- DSH Host `webServer` 路由适配；
- 浏览器 `window.__ModuleLoader__` 和 Client Effect 生命周期；
- WebUI Themes 选择器与 DSH 皮肤即时切换；
- Client 加载状态回报和缺失适配器诊断。

## 命令

```sh
seal-harness plugin --profile web add 'github:user/repo#path:/plugin'
seal-harness plugin --profile web list
seal-harness plugin --profile web doctor
seal-harness plugin --profile web remove '@scope/plugin'
```

添加或删除 Host 插件后需要重启 WebUI。第三方插件是可信 Node.js 代码，且不包含在
Seal Harness 默认安装包中。

## Deep Whale 验证

本版本使用 `dsh-deep-whale` 的 `skin-manager` 与 `maid-atelier` 完成了 GitHub 子目录安装、
删除、重新安装、Host API、Client Bundle 和浏览器主题激活验证。
