# 电脑操作：本机与虚拟机

产品内置Cua Driver 0.38.0，通过现有Seal模型/会话工具操作桌面。默认目标为**本机**，固定**仅后台**；也能保存多个虚拟机目标，经SSH调用来宾中的Driver。不是SSH/RDP/VNC客户端窗口，也不替换现有远程主机入口。

## 使用

- 在“设置 → 电脑操作”中管理目标、检查本机驱动或配置虚拟机。
- 打开需要使用的会话，再进入“设置 → 电脑操作”，确认当前会话名称后选择目标并开启或停止；默认本机。只有开启的会话获得工具，不自动恢复桌面操作授权。首页侧栏和会话输入栏不再提供电脑操作入口。
- 请先打开需要操作的软件。智能体可读取应用、窗口、界面树和截图，再操作准确窗口；截图通过原生MCP图像结果进入当前会话。
- 点击停止、退出账号或释放会话会关闭该会话所属连接。不同会话不能同时占用同一个目标。

## 固定后台模式

输入调用强制`delivery_mode=background`，仅允许准确的窗口目标。`foreground`、全局鼠标/桌面坐标、剪贴板写入、脚本/批量绕过及`bring_to_front`工具不暴露；不能依赖模型自己选择后台。

`launch_app`也不提供：应用启动可能自行抢焦点，上游仅尽力恢复，不能满足严格后台要求。用户先打开应用后使用。后台不受支持、窗口或元素已变化时返回拒绝/未验证结果，不自动切换到前台。Windows提权窗口、Wayland和部分应用有系统限制，不能宣称所有软件后台可控。

## 虚拟机准备

1. 自备带图形桌面的虚拟机（VMware/Hyper-V/Parallels/Lume等由用户管理），安装固定兼容版本的Cua Driver。
2. 开启SSH密钥登录。先在终端正常连接一次，核对并接受真实主机指纹；Seal使用`BatchMode=yes`及`StrictHostKeyChecking=yes`，不保存密码、不自动接受新指纹。
3. 填写SSH地址、端口、用户名、可选本机私钥路径，以及来宾Driver路径。检查SSH可用只说明本机客户端就绪，不能代表来宾桌面认证成功。
4. Windows来宾：在图形桌面同一用户下运行Driver daemon，再经SSH连接`mcp --socket \\.\pipe\cua-driver`。裸MCP在SSH的Session 0没有桌面，不能代替交互桌面。SSH与图形桌面需同一Windows账号。
5. Linux来宾：保持已登录图形会话、X11/AT-SPI/DBus环境，必要时填写桌面Driver的Unix socket。无显示环境的SSH会话不是桌面。
6. macOS来宾：在图形桌面启动已签名CuaDriver.app并授予辅助功能/屏幕录制，SSH MCP代理到该授权应用；不能在SSH Session内伪造系统权限。

Seal不自动创建虚拟机、安装Hypervisor、替用户批准系统权限或把本机文件/账户复制进虚拟机。没有虚拟机不影响本机模式。

## 构建与来源

`scripts/prepare-driver.mjs`按`assets/driver-manifest.json`固定资产和SHA256下载、校验并装配到忽略的`lib/runtime/<OS-arch>`；产品构建自动调用，安装包包含运行资源，不要求用户另跑curl/irm安装器。驱动不自行更新，关闭上游可选遥测，不向其他编程代理安装技能。归档和exe哈希及来源保存在provenance。

上游发布`cua-driver-rs-v0.38.0`标记为预发布，来源提交`85e2b1318bd77ccf3cfa88ccdf875a4bb7eaed19`；这不是Seal产品版本升级。基础Driver采用MIT；不包含AGPL的可选cua-perception，也不包含Spaces、Lume或云服务。许可证在assets及随包runtime中保留。macOS签名/TCC和Linux显示环境仍须对应平台实测。

参考：[Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver)、[后台交付参数](https://cua.ai/docs/cua-driver/reference/mcp-tools)、[虚拟机与SSH](https://cua.ai/docs/cua-driver/guides/vms-and-remote)。
