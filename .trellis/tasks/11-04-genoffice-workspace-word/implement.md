# 实施记录

1. [x] 核对 Stratex GenOffice 来源、Word 工作区入口、编辑 Worker、保存链路与 Seal 的 DSH 扩展点。
2. [x] 在远端 Office 文档库之外装配独立的工作区 Word 插件及 Stratex GenOffice 许可证、固定来源、运行依赖。
3. [x] Host 实现当前会话工作区授权的 DOCX 读取/安全保存与冲突检测。
4. [x] Client 从工作区 Word 预览打开编辑器，移植 Word schema/model/ribbon 与 Worker，处理装载、修改、保存和离开确认。
5. [x] 合并远端 main 后重新运行工作区 Word 与 Office 文档库针对性回归、产品 build/check 和隔离 Profile 验证。原生窗口手动操作尚未验证。
6. [x] 合并两个侧栏入口为“办公文档”；Office 文档库留在主页面，工作区文件的编辑接到 DSH 右侧文档页签。Office 仅保留 Host。
7. [x] 补齐工作区 DOCX/XLSX/PPTX 的创建、导入、读取、右侧编辑、原路径保存与导出；定向测试 35 项通过，产品 build/check 和隔离 Profile 验证通过。XLSX/PPTX 当前为结构化内容编辑，Stratex 的完整画布和高级排版尚未移植；原生窗口手动操作尚未验证。
8. [x] 移除原先 8 MiB 的独立压缩文件门槛，统一到当前 64 MiB 整文件传输与 ZIP 解压预算；真实大于 8 MiB 的 DOCX 在文档库、工作区 Host 和浏览器 Worker 路径通过，产品 build/check 和隔离 Profile 验证通过。若要取消所有整文件大小上限，需另改为流式传输与处理。
9. [x] 按用户校正的聊天流程，移除 Office 整页入口，使用 DSH 本轮产物在成功结束后自动打开工作区 Office 右侧页签，并收紧右侧文档布局。定向回归 4 项、产品 build/check 与隔离 Profile 验证通过；CUA 后台快照确认整页入口已消失，严格后台点击在 Electron 中未生效，故真实聊天生成到自动打开尚未做原生窗口端到端验证。第 6 步的主页面方案由本步取代。

用户于 2026-11-05 明确授权按功能提交并推送线上主分支；发布和跨平台安装仍需另行授权与实测。

## 2026-11-05 卡片预览与侧栏修复

- 统一资源入口：workspace-word 通过公开 SidebarRightTabRegistry patterns/canOpen 认领会话 DOCX/XLSX/PPTX，使用官方 parseFileAddress/sessionFileAddress，自动打开和手动打开统一 openResourceIn；tab.contentId 定位文件，按资源去重。既有 Host 授权/保存及未保存关闭保护保持不变。无需 Office→PDF 转换，也未改上游代码。
- UI：紧凑文档头部、按需展开“格式与插入”，格式分组可换行，展开区域可垂直滚动。没有修改 vendored WordRibbon 或文档格式引擎。
- 打包：显式 bundle 官方 workspace-path 工具，避免 peer 被当作浏览器外部模块。客户端回归对非 React 外部 require 立即失败，并使用框架真实 tab.contentId 形状。
- 构建通过；最后 workspace-word 11/11 测试通过；产品 check 全部通过，品牌及22个业务插件、重复 Profile、资源/零更新请求、Electron标准会话24个browser MCP工具、Creator/插件管理与两轮HMR均通过。记录见 .build/office-fix-build.log、office-fix-workspace-tests-final.log、office-fix-product-check-canonical-temp.log。
- 真实 Electron：旧测试卡片直达编辑器，关闭→再次点开正确；重复点开不新增页签。第二轮聊天新建 Office-QA-Fix-20261105.docx（正文“修复后自动打开验证”）后自动打开正确。实际追加“（修复后保存验证）”，取消未保存关闭后内容保留，保存后磁盘ZIP CRC及OOXML正文校验通过；关闭后从正文链接和卡片预览按钮再次打开均显示保存后的内容，只有一个文档页签。独立办公页面入口仍无注册。应用保留运行且无未保存内容。
- 布局实测：650px侧栏，工具栏clientWidth/scrollWidth均650；420px视口内工具栏415/415；360px视口内355/355。所有按钮、fieldset和select均无越界。头部宽栏由约141px降至102px；窄栏132px。恢复原视口；截图 .build/office-fix-auto-open-final.png、office-fix-reopen-saved-final.png、office-fix-expanded-wide.png、office-fix-expanded-420.png、office-fix-expanded-360.png；指标 office-fix-layout-metrics.json。
- 环境边界：系统默认TEMP为ADMINI~1短路径，未改动的两项Host新建测试曾报outsideWorkspace；只将验证进程TEMP/TMP设为用户长路径Temp后，完整检查及11项Office回归通过。未改系统配置、Host授权边界或这两项用例。Windows短路径工作区兼容性留待专项处理。
- 限制：没有验证macOS/Linux、复杂Word排版、Excel/PPT真实窗口，也未进行Codex窗口像素级对照。此次采用右侧文件页签、紧凑操作区及按需格式工具的交互。验证阶段未提交、推送或运行自动提交/归档脚本。用户随后明确授权本机提交并推送；沿用既有线上 main 目标，不打包、部署或操作其他工作机。

## 2026-11-05 右侧开始页补齐

- 用户指出之前仅实现 Office 文件编辑页签，没有实现 Codex 风格的右侧开始页。使用 DSH 公开的 `sidebar.right.tab.guide` chain 插槽替换正文，保留框架页签栏、拆分和收起操作。
- 从 `sidebarRightTabs.guide()` 读取实际安装的工具入口；浏览器网址提交到原生 browser 页签；从 `sidebarRight.openTabs` 读取当前会话已打开的 Office 文档并可切回。文档列表不宣称跨会话历史。
- 增加开始页工具、浏览器网址和文档切换回归。`corepack yarn seal-harness:build`、`corepack yarn seal-harness:check`、`node --test seal-harness-desktop/plugins/workspace-word/tests/client.test.mjs` 均通过；后者在扩充网址断言后再次通过。未做真实窗口视觉对照，不修改并发存在的 Blender/连接器等工作区文件。

### 更多设置

- 用户补充 Codex 参考图的网址栏右侧“⋯”菜单。DSH 原生 Browser 当前公开工具栏只有后退、前进、刷新、地址跳转与外部打开；Seal 开始页增加真实工具入口和工具说明、已打开文档区的显示开关，未复制无实现的浏览器菜单项。
- 菜单支持点击外部或 Escape 收起；Client 回归 1/1 通过。`corepack yarn seal-harness:build` 和 `corepack yarn seal-harness:check` 均通过，检查包含 22 个业务插件及 Electron Profile 启动/HMR。已重启本机 Seal，新 Electron 主进程正常启动；用户将窗口最小化，严格后台 CUA 无法点击“+”或抓取页面，故新菜单未做原生窗口视觉确认。
