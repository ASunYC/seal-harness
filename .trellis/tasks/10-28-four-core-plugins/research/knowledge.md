# 知识库实现记录

## 已确认接口

- WeKnora 官方 v0.8.3：`GET/POST /knowledge-bases`、`PUT/DELETE /knowledge-bases/:id`、`GET /knowledge-bases/:id/knowledge`、`POST .../knowledge/manual` 和 `.../knowledge/file`、`GET/DELETE /knowledge/:id`、`POST /knowledge/:id/reparse`、`GET /chunks/:id`、`POST /knowledge-search`。
- 管理API权限与原有检索Key不同：retrieve负责读，ingest负责文档写，manage_kbs负责库的生命周期。服务端403由界面明确展示，不默认为接口未实现或偷偷改成管理员身份。
- 来源：[routes_knowledge.go](https://github.com/Tencent/WeKnora/blob/v0.8.3/internal/router/routes_knowledge.go)、[router_api_key_capabilities_test.go](https://github.com/Tencent/WeKnora/blob/v0.8.3/internal/router/router_api_key_capabilities_test.go)、[前端API](https://github.com/Tencent/WeKnora/blob/v0.8.3/frontend/src/api/knowledge-base/index.ts)。手工文档发布状态为 `publish`。

## 边界

- 新内部Host服务 `sealHarnessWeknora` 复用现有凭据解析；新增 knowledge Host依赖 `connection,sealHarnessWeknora`，对Client不公开请求代理或Key。
- 不需要新增SQLite表。既有上游6个JS文件不改。
- 模型、OCR、索引运行在WeKnora服务器；不增加独立ONNX/embedding实现。
- 本轮只用受控HTTP服务/假Key做管理闭环与UI测试，不访问真实账号文档、不部署服务、不进行收费模型请求。

## 待集成验证

主智能体将插件加入产品Profile/build并运行真实Electron；如果本机未部署WeKnora或无管理权限，页面应诚实显示待连接或权限不足。

## 模块验证结果

- 使用 Node 24 和 Beta 已有 tsdown 定向编译 knowledge Host/Client 与 weknora Host，通过；未运行全产品构建、修改根依赖或共享产物装配脚本。
- knowledge 与 weknora 的全部 12 项测试通过：库CRUD、文本/文件multipart导入、pending与completed状态、文档预览/删除/重解析、检索来源；无效输入、401/403边界、账号/epoch、取消、拒绝重定向、8MiB响应上限与无密钥错误；真实React页面的CRUD/删除确认/模型列表权限独立/只读检索、未连接与旧账号晚到响应、导航晚加载和清理。
- DTO采用字段白名单投影，模型配置中的parameters/api_key等不进入Client；服务器返回任意原始错误正文不直接展示。
- 六个上游JS的SHA256全部保持不变；`git diff --check` 通过。
- 本机没有运行的 WeKnora/Docker，真实服务CRUD、实际embedding/OCR未执行；模块不声称模型已下载或索引已完成。由主智能体继续Profile、Windows页面与跨模块集成检查。
