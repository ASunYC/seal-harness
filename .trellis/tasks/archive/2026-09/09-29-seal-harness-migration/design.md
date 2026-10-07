# 迁移设计

## 边界

根仓库保留 DSH Desktop 的 Yarn 工作区、Stable/Beta/Next 包和 `deepseek-harness` 子模块。产品目录改名为 `seal-harness-desktop/`，仍保持非 workspace 包，由 Beta Desktop 构建脚本装配。公共 DSH 协议和上游署名不改。

## 身份映射

Seal Harness/seal-harness/GEOVIS 的产品命名映射到 Seal Harness/seal-harness；产品插件命名空间改为 `@seal-harness/*`。应用 ID 使用 `com.seal-harness.desktop`，协议 `seal-harness`，默认 Home `~/.seal-harness`，显式 `DSH_HOME` 继续覆盖。更新保持关闭，避免加载上游社区更新。

## 图标

按 ip-as-logo 约束生成一个低细节方形小海豹原图。原图作为 `app-icon.png`；沿用仓库已有图标导出机制生成 PNG/ICO/ICNS、托盘与尺寸资源，更新哈希来源记录。若原有导出工具不支持产品资源，则以同等格式工具导出，不将临时文件提交。

## 兼容与验证

先做保语义的产品名替换，再检查包解析、Cordis 插件 ID、客户端 bundle、打包配置和数据路径。来源工程的 Geovis/内网服务不作为新产品默认地址；地址为空时提供本地工作台入口，Host RPC 故障仍不得当作离线。测试重点为产品配置、装配、资源验证和构建。来源工程的旧数据不自动迁移到新 Home；此任务仅建立新产品身份。
