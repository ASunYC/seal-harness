# 设计与变更边界

保留remote-desktop包与导航id以兼容Profile，显示名改远程主机。仅产品插件、local-data迁移、对应测试与文档，不改只读上游或Stable/Beta。

local-data v8新增remote_hosts(user_id,id,name,config_json,created_at,updated_at)，复合主键，user外键；不保存秘密。config为{protocol:'ssh'|'rdp'|'vnc',host,port,username:'',identityFile:'',clientPath:''}。可选路径仅绝对路径；host允许DNS/IPv4/IPv6，拒绝URL、选项和控制字符。identityFile仅SSH。

Host服务RPC保留前缀seal-harness-remote-desktop，动作snapshot/save/delete/check/connect。snapshot->{hosts:[{id,name,config,createdAt,updatedAt}],platform,clients:{ssh,rdp,vnc}}；save({id?,name,config})->{host}；delete({id})->{deleted:true}；check({id})->{client:{available,executable?,reason?},network:{reachable,reason?},checkedAt}；connect({id})->{launched:true,client,hostId,message}。check是TCP连通性探测，不证明认证或协议可用；connect只打开客户端，不预先阻断原生客户端诊断。所有操作绑定账号epoch，退出/卸载取消检查；不杀死交给用户操作的外部终端，页面离开不关连接。

clients.js模块接口createRemoteClients({platform?,env?,spawn?,...}) -> {inspect(config):Promise<{available,executable?,reason?}>,launch(config,signal):Promise<{client:string}>,probe(config,signal):Promise<{reachable,reason?}>}。spawn shell:false，argv数组；Windows SSH明确请求可见交互窗口；RDP/VNC用户明确连接才显示。无秘密参数/配置文件，不转发任意extra args。

UI保留导出RemoteDesktopPanel({api})，管理表单、搜索、协议筛选、行检查/连接/编辑/确认删除；异步结果不得污染切换后账号，检查结果按主机配置失效。表单失败保留草稿。客户端路径可指定，不自动安装。
