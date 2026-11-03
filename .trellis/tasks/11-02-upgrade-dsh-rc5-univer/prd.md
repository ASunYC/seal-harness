# 升级DSH至0.2.1-rc.5并安装Univer Office

## Goal

升级Seal活动Beta内核、保留用户数据，在实际desktop Profile安装并验证dsh-univer-office

## Requirements

- 将Seal实际使用的Beta DSH内核从0.2.1-rc.2升级到官方最新发布0.2.1-rc.5（不是自动跟随master或0.2.2实验分支）。用户已明确授权内核升级及安装dsh-univer-office。
- 保留产品品牌、发布版本、独立Home及更新渠道；保留账号/凭据、会话、工作区及已有插件。升级前备份实际用户数据库与Profile配置至忽略目录。
- 子模块仅调整固定提交，不修改其源码；以对应官方npm包及原字节哈希准备Beta运行时，移植必要叶子补丁。Stable/Next保留原pin，共享必要兼容改动Beta先行再镜像。
- 内核完成验证后，用公开Desktop CLI/插件服务将官方dsh-univer-office固定版本安装到当前desktop Profile，不把命令装到无关web Profile；保持现有插件列表。插件匿名遥测关闭，与产品现有隐私设置一致。
- 本轮实施和安装授权不等于推送/发布授权；代码保留可审阅状态，未来提交时pin独立提交。

## Acceptance Criteria

- [x] 官方版本、源码提交、Beta清单/依赖/原始包与锁文件一致；安装树不混用旧Beta内核。
- [x] 核心类型/双变体/受影响回归与完整产品build/check通过；原Profile图形启动、历史会话保留；真实standard新会话和MCP工具初始化通过，未发送模型消息。
- [x] 实际desktop Profile可识别并激活Univer；14个工具、带身份的Viewer及表格创建/写入/读取/Excel导出均通过。
- [x] 已有配置/账号/工作区/会话保留，记录备份、实际验证和未测平台；不发送无关付费模型消息。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
