# 工程规范

## Pre-Development Checklist

实现前阅读 [通用工程原则](engineering-principles.md)。涉及桌面准备、插件、品牌、打包或上游升级时，再阅读 [桌面构建契约](desktop-build.md)，并核对根 `AGENTS.md` 的下游优先规则。

## Quality Check

涉及本机应用安装、启动和自动接入 MCP 时，阅读 [应用管理契约](application-management.md)。

涉及系统技能、连接器目录或 cc-haha 能力迁移时，阅读 [系统能力目录契约](capability-catalog.md)，检查完整内容、安装与凭据边界。

验证按构建契约执行，区分源码检查、构建、安装和真实平台验证。未执行的项目不能报告通过。

涉及 Token 统计、WeKnora 知识库管理、远程桌面或 ACP Runner 时，阅读 [工作台插件契约](workbench-plugins.md)，核对真实数据、身份范围、外部依赖和子进程/控制连接的生命周期。
