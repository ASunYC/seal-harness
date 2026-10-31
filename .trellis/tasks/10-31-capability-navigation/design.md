# Design

导航插件继续管理一级栏。能力是一级入口，但四个子页继续使用原有 `main` key；通过当前 panel id 判定能力选中状态，并在一级栏旁渲染二级菜单。插件保留 DSH 原生 `plugins` panel，市场保留现有 `settings.plugins.tab` 桥接页并从能力二级菜单访问。非能力页面继续沿用全宽布局。

Token 统计插件将原有 `Panel` 注册为 `settings.section`，保持 API 和统计实现不变。更新测试以覆盖入口位置、切换和顺序。
