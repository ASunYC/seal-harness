# Seal Harness v0.3.3

Web 产品基础壳层补全版本。

## 新增

- 侧栏固定 Settings 入口；
- General、Models、Plugins 三分区设置中心；
- Workspace、主题、安全策略说明；
- Provider、模型、推理等级和进程内 API key 配置；
- 插件清单卡片、版本、来源、启停状态和缺失适配器诊断；
- WebUI 内安装、启用、停用和删除插件；
- 插件管理写 API 仅允许回环地址调用；
- `?settings=general|models|plugins` 可直接打开指定设置页。

## DSH 对照

本版本实际启动了 `@deepseek-ai/dsh-web-frontend@0.1.1-rc.2`，并检查了 DSH 的
ui-layout、ui-sidebar、ui-settings、ui-settings-models、ui-settings-plugins、
ui-settings-plugin-inventory、ui-workspace 和 ui-conversation 契约。Seal 复用其产品信息
架构，但保持原生无框架页面和既有轻量服务边界，不引入 DSH 的约 500 项运行依赖。

## 注意

添加、删除或改变 Host 插件启停状态后，需要重启 WebUI。第三方插件仍安装在隔离
Profile，不进入默认安装包。
