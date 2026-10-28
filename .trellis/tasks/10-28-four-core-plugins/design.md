# 技术设计

- 沿现有 Cordis Host/Client 分层和 Connection RPC envelope。Host 以本地 identity 确认账号，不接受客户端自报账号。Client 经导航服务注册 `{ id, label, icon, order, primary: true, Panel }`；主导航统一处理主页面注册、顺序与侧栏隐藏。
- Token 用量由真实 DSH 会话事件/公开 token-meter 接口产生，明确累计/增量语义并以稳定事件键去重；持久记录进产品 SQLite。历史日志如可安全归属则导入，否则说明统计起始边界。
- 知识库通过现有 WeKnora Host 连接服务复用当前账号凭据；密钥不回传。库/文档/索引管理属于 WeKnora，Seal 提供管理及检索界面，原生模型设置可打开；本地 ONNX 不是无条件新增的第二套实现。
- 远程桌面优先公开 DSH computer-use/desktop 服务；需要平台适配时局限产品插件，真实检查宿主能力，截图与输入绑定会话。无支持驱动/独立 Host/手机未配对时明确 unavailable，不创建假连接。
- ACP 优先 DSH 的 ACP transport/subagent 服务与已装 SDK。预设只是可编辑命令声明，不静默安装或登录第三方 CLI；配置状态和真实握手状态分开。校验输入及子进程关闭/取消，秘密放 Host credentials。
- 持久层新增 schema 由模块负责人提议、主智能体统一加入 local-data 前向迁移；模块不得自行改 PRAGMA 或另建 SQLite。无持久需求的远程控制使用内存连接，退出/账号切换时释放。
- 工作区共享：子智能体只写被分配模块及本任务 `research/<module>.md`；主智能体串行修改共享文件。任何需要共享接口变动先发送具体契约，由主智能体整合。
- 回滚按插件独立装配项进行，保留既有数据；不删历史账号/会话/能力配置，不改变产品或依赖版本。
