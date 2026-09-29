# 能力模块插件选型

2026-09-23 通过 GitHub Search/Repositories API 核对热度和最后 push 时间，并阅读各仓库 README、包声明及相关源码。Stars 是当时快照，不是兼容性验收。

| 项目 | Stars | 最后 push（UTC） | 许可证 | 可参考能力 | 对Seal Harness的边界 |
| --- | ---: | --- | --- | --- | --- |
| [zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web) | 7,941 | 09-22 18:42 | Apache-2.0 | 独立 Skill 中心、预设中心、创意工坊 | 优先研究独立包，不装整套 UI 聚合。自身社区目录不等于 Stratex 后端 |
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) | 4,392 | 09-23 00:08 | MIT | 搜索、分类、收藏、安装更新、启停、卸载、恢复 | npm/GitHub 插件包管理；可换目录 URL，但要求自己的 plugins.json，不支持 Stratex 资产信封及安装解析协议 |
| [bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) | 167 | 09-23 00:31 | MIT | 插件与技能索引、安装管理 | 适合社区发现，不负责企业资产发布/权限 |
| [MichengAI/dsh-skills-manager](https://github.com/MichengAI/dsh-skills-manager) | 63 | 09-22 18:37 | Apache-2.0 | 多来源技能、无损启停、导入、仓库安装、更新预览、回滚、回收站 | 作者声明测试覆盖当前安装的 0.1.5-rc.2；需继续核对公开服务和 Stratex 目录授权/副本语义 |
| [xxxyz/DeepSeekHarness-MCP-Manager](https://github.com/xxxyz/DeepSeekHarness-MCP-Manager) | 21 | 09-10 06:59 | MIT | MCP CRUD、启停、真实 loader 状态/工具数、配置持久化 | 写 profile patch；其鉴权和浏览器 token 处理不能直接替代Seal Harness用户/凭据服务 |
| [Js2Hou/dsh-mcp-manager](https://github.com/Js2Hou/dsh-mcp-manager) | 19 | 09-22 08:34 | MIT | MCP 可视化管理与连接状态 | 作为针对性参考，仍需后端和凭据适配 |

## 源码已确认的限制

`dshmarket@1.57.0` 公开导出主插件和 `./update-api-v1`；`src/registry.ts` 的 Registry 是插件仓库条目，`src/install.ts` 面向 pnpm 插件安装。不能仅修改 `DSHM_REGISTRY_URL` 就安装 Stratex Skill/MCP/专家 ZIP 资产。可以复用社区插件管理作为另一个产品能力，但它不属于本次四模块完整迁移的替代品。

dsh-web 的 `packages/dsh-skill-explorer` 和 `packages/dsh-preset-center` 分别发布为 `@linxin666/dsh-client-ui-skill-explorer` 与 `@linxin666/dsh-client-ui-preset-center`。二者及独立 market 包的 0.3.24 package.json 均标注 **BSD-3-Clause**，不同于根仓库 Apache-2.0，复用必须逐包保留许可。将它们作为优先参考，不复制整套 Desktop、默认预设或品牌。

`Rain-kl/dsh-preset-plus` 有 133 stars、MIT，但核心是消息上下文/提示词预设，不是 Stratex 专家资产与版本管理。高 star 的路由、记忆、设计技能项目也不因此成为技能管理器，未纳入候选。

当前已安装 DSH 包为 `0.1.5-rc.2`，只读子模块的开发源码已有不同 API。适配和验证必须以实际安装包导出为准。尚未安装、运行或验收上述社区插件，不把 README 声明记作本地兼容通过。

## 当前取舍

优先直接使用已安装的官方技能 provider、MCP client、credential 与 Agent preset 服务。社区插件用于核对功能覆盖和交互；只有其公开扩展点足以保留 Stratex 后端、用户权限、来源隔离时才替换自有适配。实现公共后端协议与产品专属资产生命周期仍是必要工作。每个模块的后续判断记录在迁移任务中。
