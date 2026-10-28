# Token / 远程桌面交叉审查

审查者：knowledge 子智能体。只读审查 `token-stats/` 与 `remote-desktop/`，未修改模块或共享源码。未重复报告负责人正在修复的“检查自动附着连接”和“输入失败时保留草稿”。

## 结论

本轮没有确认需要阻断集成的新问题。以下是已核对的实际行为，不是对未执行平台或真实系统输入的通过声明。

## Token 统计

- `service.js:capture` 在 turn/start 以 `(session_id, turn)` 唯一键记录当时账号；turn/end 只更新 pending，后续切换账号或重复 start/end 不会重新归属或累计。查询在 SQL 中限定当前账号，且 strict schema 拒绝 userId 注入。
- `projection.js` 使用公开 `deriveTurnTokenUsage`，保留所需生命周期和用量；消息正文和工具结果不进入投影。已对照上游 `turn-usage.ts` 的 retry/attempt/step 语义，投影没有丢掉计费归并所需的边界。
- 缓存和推理未知字段保持 null，未返回完整用量的轮次单独计数。多模型同轮标为合并归因；不导入无法确认归属的历史。中断 pending 可能长期未结算，README 和页面将其称为“未结算”，没有冒充仍在执行。
- Excel 使用 OpenXML inlineStr，不把模型/专家名称当公式；所有分组均保留未知桶的语义。

## 远程桌面

- Service 的 connectionId 绑定账号与 epoch；账号订阅触发 release，所有截图/输入在执行及结果返回前再次核对连接；disconnect/dispose abort 连接信号并等待已跟踪操作结束。
- 归一化坐标由 Host schema 限定 0–1，`input.js` 映射到截图返回的物理尺寸与原点；截图子进程设置 DPI-aware，输入使用 SetPhysicalCursorPos。不是把缩略图 CSS 像素直接当屏幕坐标。
- 输入由显式 allowControl 授权，默认只读，frameId 排除已知旧画面；拖拽和键盘异常路径尝试释放本批按下的鼠标键/修饰键。
- 截图使用固定 EncodedCommand，没有拼接输入文字或任意路径；窗口隐藏，截图只驻留内存。驱动只支持 Windows，其他平台和手机明确 unavailable。
- 打包依赖已核对：remote-desktop peer 声明 koffi 3.1.5，共享 build 的 neverBundle 已包含 koffi，避免把原生依赖错误打入 JS。

## 实际执行

Node 24 定向运行以下测试，18/18 通过：

`token-stats/tests/{usage,host}.test.mjs`、`remote-desktop/tests/{service,driver}.test.mjs`。

覆盖真实 Cordis Session→投影→RPC、重试、缓存、跨重启归属、重复结算、时区、Excel、账号/epoch撤销、排队输入取消、截图合并与节流、空闲释放、物理坐标与按键释放。

本轮没有执行真实屏幕截图、系统鼠标/键盘输入、计费模型调用、安装包或跨平台实测。主智能体仍需完成实际 Electron 与安装产物的集成验收。
