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
