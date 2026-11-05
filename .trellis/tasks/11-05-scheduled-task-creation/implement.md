# 实施

1. 修复导航指向产品定时任务，保留原会话提醒入口与高亮。
2. 调整已有产品表单与左右布局，统一已确认24/600标题和中性控件。
3. 增补真实持久化表单和导航测试，运行原调度/runner检查。
4. 构建安装两个产品插件，后台GUI检查新建/取消与主题布局，不在用户数据库创建启用任务。更新契约和完成记录，不提交。


## 完成与验收

根因是navigation指向上游native schedules，其onNewTask明确调用startSession，并非产品已有表单模块。修复一级指向seal-harness-schedules，native页面从“查看会话提醒”仍可达且正确高亮。没有修改上游、Host服务、数据库或runner。产品表单页整理为左列表右编辑，保存用真实返回id选中新记录，筛选/删除后不留陈旧详情，按钮主题沿用中性颜色。

导航及scheduled-tasks共22项测试全部通过。UI测试从原纯假API升级为真实ScheduledTasksService+临时SQLite，覆盖两处新建/取消、保存不打开会话、四频率入库/未来时间、立即运行/执行记录/暂停/删除，并将表单保存的interval任务交给真实tick，验证到期执行结果。原Host RPC与native session runner、账号隔离、重启/错过/重叠等测试保持通过。测试执行回调使用隔离夹具，不调用外部付费模型。

仅构建并装配navigation和scheduled-tasks成功，产品verify通过（22业务插件），diff --check通过。真实Electron通过后台CDP reload验证：1440/1000/700宽度、浅深主题、四种频率共24组创建/取消检查通过，始终停留计划页、表单无横向溢出；原native提醒入口往返及导航高亮通过。已查看浅深创建页截图。未将窗口置前、未进行系统鼠标/键盘操作，未在用户账号保存或运行测试任务。恢复原主题/窗口尺寸，应用留在创建表单供用户查看。

证据：.build/schedule-create-build.log、schedule-create-tests.log、schedule-create-smoke.log及schedule-create-浅色/深色.png（忽略目录）。未提交/推送/发布，未调用自动提交的归档或journal命令。
