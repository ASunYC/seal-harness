# 设计边界

共享源码 capability-shared 增加固定目录快照、来源校验和安装适配。保留 cc-haha 的 native CLI 下载/校验/授权源码在 vendor，只有相对导入扩展名适配；不引入其 Claude 运行时。现有 connectors 模块增加系统安装与 CLI 工具桥接、原有 credentials 配置承载 header/query/OAuth；现有 skills 模块增加目录预览、固定 bundle 和精选市场包安装。

系统列表在各模块 list 返回值中附加，不自动安装。图标由原 SVG 字节转换 data URL，所有来源文件哈希记录。安装后的能力仍由现有状态/持久化/注销逻辑管理，不另建数据库或锁文件。

必须改动：共享目录/安装器、connectors schema/runtime/module/credentials UI/system catalog UI、skills module/system catalog UI、产品文档与测试。避免改动既有定时任务源码或其验收结果。新增在线技能下载仅固定可信源与版本，所有文件均通过现有包路径、大小和完整性校验；无网络时明确失败而不创建已安装记录。
