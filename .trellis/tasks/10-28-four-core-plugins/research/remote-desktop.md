# 远程桌面插件实现与证据

## 接缝与边界

- CodeGraph 首先查找了 `ComputerUseRegistry` 与 Desktop 远控，返回 auto-sync disabled；之后直接读取源码核对。
- `deepseek-harness/packages/computer-use/computer-use/src/index.ts` 仅提供电脑操作提供者独占登记，不提供可调用的截图/键鼠 API。
- 上游 `experimental/computer-use-cua-driver-native` 暴露 Cua 工具，但当前 Beta 未安装该包。未强装或深度引用；Octop 的 Python capture/input 只作能力边界参考，没有复制其运行时或品牌。
- 采用产品自有 Windows 驱动：固定 PowerShell + GDI 截图，已安装 `dsh-plugin-desktop-beta/node_modules/koffi@3.1.5` + user32 系统输入。`koffi` 在 Host 构建中需要外部化，已通知主智能体；peerDependency 指定现有版本。
- 无共享数据库/PRAGMA或 Desktop 源码修改需求。仅写入 `plugins/remote-desktop/` 与本文档。

## 已实现

检查（不截图）、显式连接、默认只读、勾选控制后重新连接、主屏 JPEG、物理坐标映射、点击/双击/拖动/滚动/标准键/Unicode 文字。当前账号、登录 epoch、连接 id 和最新帧 id 共同约束操作；身份切换、断开、卸载、截图错误和 60 秒空闲清理；限流与取消覆盖。

RPC 路径及参数见插件 README。Client 用 `primary: true`、order 120、id `remote-desktop`、icon `desktop` 注册，处理导航服务晚到。手机明确未接入；macOS/Linux 暂无驱动，返回不可用，不伪装已支持。

## 本轮实测

- `node --test seal-harness-desktop/plugins/remote-desktop/tests/*.test.mjs`：15 项通过（驱动 5、服务 7、RPC 1、Client 2），包含可控时钟下的空闲过期和帧刷新续期。Client 用 Beta 已安装 tsdown 单独编译，不运行共享 build 或安装依赖。
- 真实 Windows `createDesktopDriver().check()` 返回 available/inputAvailable true。只读 `capture()` 成功：主屏 3840×2160，返回 1400×788 JPEG，约 94KB。终端仅输出尺寸、字节数与 SHA256，没有输出或保存图像。没有执行真实输入。
- 输入的 SendInput 结构初始化已在真实 Windows check 路径完成；正确鼠标物理坐标、修饰键顺序、Unicode 代理对、拖动失败后 mouse-up 由 fakes 验证。
- 首次 UI 测试失败是测试 VM 缺少 AbortController/定时器，补齐浏览器运行时测试环境后通过，无生产逻辑回退。
- 全产品构建/Profile、实际 Electron 页面截图由主智能体统一负责；不宣称 macOS/Linux 或签名安装通过。
