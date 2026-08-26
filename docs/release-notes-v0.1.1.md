# PiHarness v0.1.1

Windows 易用性补丁版本。

## Windows 双击启动

1. 下载并解压 `piharness-windows-x64.zip`；
2. 双击 `Start PiHarness.cmd`；
3. 保持状态窗口打开，浏览器会自动进入 WebUI；
4. 关闭状态窗口即可停止 PiHarness。

原有命令行方式继续保留：

```powershell
.\piharness.cmd web
```

发行工作流会在 ZIP 解压后同时验证命令行入口和双击入口。以后所有 Windows Release
都会包含 `Start PiHarness.cmd`。

## 安全提示

WebUI 默认仅监听 `127.0.0.1`。当前版本没有用户认证，不要直接暴露到公网。
