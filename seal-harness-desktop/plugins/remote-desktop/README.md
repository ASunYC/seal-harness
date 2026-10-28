# Seal Harness 远程主机

`@seal-harness/remote-desktop` 保留原包名及导航 id，页面改为“远程主机”。按当前 Seal 本地账号保存多台服务器的 SSH、RDP 或 VNC 配置，支持添加、编辑、搜索、协议筛选、检查与确认删除。已移除本机截图及键鼠控制。

## 使用

1. 添加主机，选择协议，填写名称、主机名/IP及端口（SSH 22、RDP 3389、VNC 5900，可修改）。IPv6填写原始地址，不带方括号、协议或端口。
2. SSH 可填写用户名及本机私钥文件的绝对路径；留空沿用 OpenSSH 默认配置/SSH Agent。密码及私钥口令在终端输入。
3. “客户端设置”可指定对应协议程序的绝对路径，不接受命令或附加参数。未指定时自动查找。
4. “检查”分别检查客户端可用性及目标TCP端口；端口可达不证明协议、密码或登录有效。“连接”打开独立原生客户端窗口，在该窗口确认主机身份/证书并登录。
5. 关闭Seal页面、删除配置或退出Seal账号不会关闭已交给用户的外部客户端窗口；需要在客户端断开会话。

Seal不保存密码、私钥内容或口令，不关闭SSH主机校验或RDP证书校验。SQLite v8的`remote_hosts`与既有产品数据库共用，按`(user_id,id)`隔离，不建立第二个数据库。

## 客户端依赖

| 协议 | Windows | macOS / Linux |
| --- | --- | --- |
| SSH | OpenSSH + 系统PowerShell启动可见终端 | OpenSSH + Terminal / x-terminal-emulator、gnome-terminal、konsole或xterm |
| RDP | 系统`mstsc.exe`，用户名和密码在原生登录提示填写 | `xfreerdp3`或`xfreerdp`及交互终端；macOS需可运行的FreeRDP图形环境 |
| VNC | TigerVNC Viewer | TigerVNC Viewer，Linux同时识别`xtigervncviewer` |

缺失客户端不会自动安装。Windows自定义程序仅支持`.exe`；选择的程序必须与协议匹配。VNC使用TigerVNC的`host::port`格式，不支持用其他不兼容客户端的命令行代替。私钥文件必须能被当前系统用户读取。RDP/VNC远端需已启用服务、网络可达并有有效账号。

原生协议接口依据：[OpenSSH ssh](https://man.openbsd.org/ssh)、[Microsoft mstsc](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/mstsc)、[TigerVNC vncviewer](https://tigervnc.org/doc/vncviewer.html)。

## 验证与换机验收

测试覆盖数据库升级与重启、账号隔离、严格参数、CRUD失败保留草稿、原生客户端argv及Windows静态PowerShell broker的真实参数解析、macOS静态AppleScript参数引用、本地TCP成功/拒绝/取消/超时、RPC与页面生命周期。Windows本机检测到OpenSSH及mstsc，TigerVNC未安装时提示不可用。

当前没有远程设备，未验证真实SSH认证、RDP/VNC图形会话、网络断线后的客户端行为或macOS/Linux运行。换机后使用以下清单，不把进程启动当成远端登录成功：

- SSH：密码/密钥登录、首次指纹确认、指纹变化拒绝、交互终端和退出。
- RDP：自定义端口、账号/域、证书确认、画面/键鼠和断开。
- VNC：安装TigerVNC、配置非默认端口、认证、画面/键鼠和断开。
- 通用：关闭Seal页面保留原生会话；删除配置不关闭会话；账号切换不能看到另一账号的配置。
