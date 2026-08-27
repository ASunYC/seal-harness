# Seal Harness v0.3.0

DSH 插件兼容版本。

## 新增

- 新增可选包 `@seal-harness/dsh-compat`，运行真实 `@deepseek-ai/cordis` 4.0.1；
- 支持 DSH 函数、类、对象和 module namespace 插件；
- 支持 `apply`、`inject`、Standard Schema `Config`、Cordis Service/Event/Fiber/Effect；
- 把 DSH `ctx.tools.register()` 工具桥接到 Seal Harness ToolService；
- 所有桥接工具继续经过 JSON Schema、Policy、Approval 和结果限制；
- 增加已打包 npm 产物的 DSH 插件启动、卸载烟测。

## 使用

兼容层不是默认运行时的一部分。开发自定义 Profile 时安装：

```sh
pnpm add @seal-harness/dsh-compat
```

然后在 `seal-harness.config.mjs` 中通过 `dshCompatPlugin` 加载现有 DSH 插件。完整示例与
兼容边界见 `docs/dsh-compatibility.md`。

## 边界

本版本不模拟 `cordis.yml` Loader、HMR、DSH Web Client 或完整 DSH Agent/Session/
Workspace 宿主。DSH 插件仍是拥有 Node.js 进程权限的可信代码。

## Windows

默认 Windows 自包含包的运行方式不变：解压后双击 `Start Seal Harness.cmd`。
