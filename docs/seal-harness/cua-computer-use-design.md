# Cua Driver 内置电脑操作方案

调研日期：2026-11-03。已进入两模式实施：默认本机并强制后台，VM通过SSH连接来宾桌面。禁止提交/推送的既有要求继续保留。

## 结论

新增产品插件`seal-harness-desktop/plugins/computer-use/`，名称`@seal-harness/computer-use`。复用Cua Driver的原生桌面执行层和stdio MCP，保留Seal现有模型、Agent、工具权限和会话。默认内置但未启用，由当前账号在会话中启用“电脑操作”，默认目标为本机；切到虚拟机时明确选择已配置目标。不引入Cua Agent模型循环、Cua Cloud账户、Spaces/Lume虚拟机或Bench。

与已有能力分工：Playwright继续承担网页自动化；远程主机保持SSH/RDP/VNC原生客户端入口；computer-use负责让AI读取和操作当前桌面的应用窗口。Driver不需要虚拟机，因此本机计算器/记事本可完成真实验收。虚拟机模式在来宾部署Driver，经严格known_hosts和密钥/Agent认证的SSH stdio连接；已有远程主机配置不会自动获得电脑操作权限。

## 上游证据与许可证

本次检查源码快照：`trycua/cua@e2c8e33e51233731ad7525126434853775fa0128`。

- 根`LICENSE.md`为MIT；`libs/cua-driver/rust/Cargo.toml`workspace声明MIT，源码版本0.38.0。真正分发前仍应复核锁定发布资产及其完整第三方通知，不能把workspace版本当成已确认的稳定发布。
- `libs/cua-driver/README.md`明确基础Driver不需要模型文件；可选`cua-perception`中的OmniParser检测器为AGPL-3.0-only。本方案不装配该扩展。仓库还含不同许可的Spaces产品，不能把根MIT结论扩大到所有组件。
- Driver提供`cua-driver mcp`（stdio）；Windows/Linux直接持有runtime，stdin EOF后关闭；macOS通常经CuaDriver.app保持系统授权身份。macOS嵌入模式需要明确的私有服务/socket及签名归属，不能直接套用Windows的单exe方式。
- 支持现代MCP2026-07-28及legacy2025-06-18初始化；Seal现有MCP客户端必须真实协商后再确定兼容发布版本，不能只凭协议名称推断兼容。
- `bounded`模式要求已批准的能力清单及过期/空闲时间；无效清单应拒绝启动。资源可按应用可执行路径（macOS bundle id）限制；全桌面与应用窗口权限不同。
- Windows较低完整性进程不能控制更高完整性窗口；Linux Wayland支持按compositor不同，macOS需要Accessibility及Screen Recording。背景输入不是全平台、全应用保证。

来源：

- https://github.com/trycua/cua
- https://github.com/trycua/cua/tree/e2c8e33e51233731ad7525126434853775fa0128/libs/cua-driver
- https://cua.ai/docs/cua-driver/quickstart
- https://cua.ai/docs/cua-driver/reference/cli/serve-and-configure
- https://cua.ai/docs/cua-driver/reference/mcp-tools
- https://cua.ai/docs/cua-driver/guides/permissions
- https://cua.ai/docs/cua-driver/concepts/platform-support

## 产品接入

1. 系统能力中显示“电脑操作（Cua）”，由内置插件登记到现有会话能力选择流程，用户无需手工填写MCP命令。
2. 设置页显示驱动版本、平台、可执行文件、权限诊断、允许应用、当前使用会话和停止按钮。不新增一级大菜单。
3. 在会话开启能力时，Host创建当前账号/epoch/会话绑定的作用域，装配Driver。停止、退出账号、会话释放和插件卸载撤销授权及清理所属进程；不调用全局stop/revoke误伤用户自行运行的其他Cua实例。
4. 同一物理桌面同时只允许一个Seal会话执行写操作。不同Seal本地账号不会获得OS级桌面隔离；需要隔离桌面时使用不同系统会话或沙箱，不以本地账号隔离冒充桌面隐私隔离。
5. 工具按需暴露：应用/窗口列表、窗口状态（可访问性树和图像）、点击/输入/快捷键/滚动/拖拽。先由用户打开应用，不暴露launch_app：应用可能自行抢焦点，不能满足本次严格后台要求。初版不提供任意脚本执行、任意进程终止、全局配置变更和驱动自更新。
6. 接入Driver随包操作指导，包含观察后行动、索引/capture时效及后台操作限制；内容固定版本并保留来源，不因MCP资源存在就假定Seal已经自动加载skill。

## 数据流和技术边界

`Seal会话/模型 → scoped tools → computer-use Host → 现有DSH MCP客户端 → cua-driver mcp → OS原生接口`

`Driver观察结果 → MCP image/text/structuredContent → DSH原生工具结果 → 同一Seal会话`

优先复用`@deepseek-ai/dsh-mcp-client`、公开Cordis作用域、`ctx.tools`与`ctx.subprocess`，参考现有connectors的MCP装配和会话工具隔离；不直接注册一个全局可用的stdio连接器绕过会话授权。集成时检查现有进程API能否启动原生exe与完整中止；确有缺口再记录最小改动。

图像必须保持MCP图像内容块和媒体类型，不能JSON.stringify后当文字返回。当前模型能否理解图片另行检测；基础桌面执行不强制使用Cua专用模型，也不替换现有模型选择。图像可能进入正常会话历史，界面须与现有附件/工具结果口径一致；不另建截图日志库。

当前运行时发现和写入操作保留Driver的snapshot/capture/session关联字段，不自行去掉或伪造。断线或超时后先重新观察，不能自动重放点击/输入。权限模式与清单由Host生成，Agent不得修改自身授权。保持产品原有工具审批，不新增每次点击重复授权流程。

## 分发与打包

- 固定一个经过Windows实测的Driver发布版本/源码提交，不自动跟随main或nightly。
- 开发阶段允许指向已安装的Driver绝对路径；生产安装包按OS/arch附带经过校验的Driver资产和第三方许可。真正内置完成的验收包含离线机器无需另外运行安装脚本。
- 资产来源、版本、SHA256、许可证/NOTICE及构建参数进入产品provenance；更新跟随Seal发布，不运行上游curl/irm安装器，不启用独立自更新。
- 不另加Python/Node运行时或第二套模型服务；macOS保留正确签名、bundle和TCC身份。Linux系统桌面依赖在各目标平台验证，不以文件存在判定可用。
- 核对并关闭不必要遥测及后台下载，避免复制上游个人全局配置；使用产品私有配置/缓存目录。具体环境变量和启动参数在固定版本上测试确认。

## 实施顺序和验收

阶段一：固定候选资产，记录许可证及校验和；通过现有MCP客户端实际完成初始化、tools/list、权限检查。验证未启用时不启动Driver、不读取桌面。此阶段不算最终内置完成。

阶段二：实现Host作用域/工具过滤/停止生命周期与Client状态设置，接入系统能力。保留图像内容块，测试跨账号/跨会话、并发写锁、取消/重启、进程退出与过期capture。

阶段三：Windows使用真实计算器验证6×7显示42；使用专用记事本文档验证输入、快捷键、滚动、窗口切换、保存与回读。结果必须来自新截图或应用树，不能只让模型回答预期值。同时测试权限缺失、目标退出、错误窗口、用户停止与Driver崩溃。

阶段四：各平台随包资产、产品build/check/Profile、宽窄UI、安装包离线启动、签名及macOS授权、Linux显示服务逐项验收。Windows通过不代表其他平台通过。

本期排除：Cua Cloud、自动创建Cua Spaces/Lume虚拟机、训练/Benchmark、可选AGPL视觉解析器、HTTP远端网关，以及把Seal模型循环替换为另一套Agent。已接入已有虚拟机的SSH stdio通道。

## 2026-11-03实施证据

- 固定发布0.38.0（上游prerelease），实际release源码85e2b1318bd77ccf3cfa88ccdf875a4bb7eaed19。Windows归档SHA256已验证，完整驱动/helper/SDK与MIT/第三方通知随lib/runtime装配。
- 29项回归通过：UI7、runtime10、service/Host/后台桥12；包含真实OpenSSH到隔离ssh2服务及MCP图像、真实Cordis作用域图像投影。
- 真实Windows Driver握手发现63个工具。后台测试窗：set_value写入中文并读回，UIA Invoke点击按钮并从新tree读回Count:1；图片实际返回，操作前后前台窗口及系统鼠标坐标完全相同。没有使用前台模式、全局鼠标或模拟成功。测试窗已清理。
- 真实VM桌面及macOS/Linux目标仍需设备验收；本机通道和VM传输夹具结果不能替代它们。

产品build/check/Profile完整通过；实际Seal会话本机启动/停止、VM配置与宽窄UI通过；随包驱动hash/helper/许可检查通过。真实VM与其他系统继续作为设备验收项。

## 入口调整（2026-11-03）

用户要求唯一入口改为设置菜单的电脑操作；删除首页resource和会话输入栏按钮。设置页使用公开根useSessions读取mainView引用对应会话，显示标题，保留该会话的启停、目标配置和状态。无会话时不启动、不创建会话。此前“首页/输入栏入口”的设计被此调整取代；后台与账号/会话隔离不变。
