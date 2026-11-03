# 实现契约

新增seal-harness-desktop/plugins/computer-use。分工：root负责service/session-scope/MCP桥、RPC与构建装配；runtime worker负责config.js、runtime.js、driver assets/manifest与准备脚本、tests/runtime.test.mjs；UI worker负责client.jsx/styles.js/tests/client.test.mjs；checker审查后台不回退与隔离。

配置Profile={id?,name,mode:local|vm,driverPath:'',guestOS:linux|win32|darwin,host:'',port:22,username:'',identityFile:'',socket:''}。本机默认目标固定id local/name本机（可调driverPath但不可删除）。VM id uuid，SSH字段仅VM有效，用户名/主机/端口严格限制；禁止额外shell参数。后台始终强制，无前台开关。

runtime接口：createComputerRuntime({platform?,home?,...}) -> { inspect(profile,signal):Promise<{available,reason?,version?,command?}>, launch(profile,options):Promise<McpRuntime> }。options含signal、sessionLabel，后台边界由root工具桥再次过滤。McpRuntime={listTools():Promise<raw MCP tool[]>, callTool(name,args,signal):Promise<MCP content result>, close():Promise<void>}。可用现有@modelcontextprotocol/sdk客户端和stdio transport（保持image content）；若用DSH MCP客户端root可适配实际接口，worker与root明确约定。VM用本机OpenSSH -T/BatchMode/StrictHostKeyChecking=yes调用固定remote driver mcp；Windows用mcp --socket已存在交互daemon，Linux socket路径可配置，绝不自动起Session0 runtime。

持久配置通过Host credentials grant按accountId保存，不新增SQLite migration。运行连接由root按account/epoch/sessionId绑定，不恢复授权。全局可见工具只能状态列表；会话开启后createScope注册MCP tool definitions。过滤器必须检查模式为background/foreground=false等上游实际字段，并拒绝bring_to_front及原始desktop/pointer动作；保留capture/snapshot/session ID。强制保证背景交付的机制要依据固定版本工具schema/原生反馈，不能只在提示词里承诺。

RPC前缀seal-harness-computer-use: snapshot({sessionId?})->{profiles,defaultMode:'local',backgroundOnly:true,runtime:{...}|null}; save({profile})->{profile}; delete({id})->{deleted:true}; check({id})->runtime诊断; start({sessionId,id:'local'|uuid})->{runtime}; stop({sessionId})->{stopped:true}。Profile表单字段如上；snapshot profiles始终含local。status/runtime返回{targetId,targetName,mode,status,sessionId,backgroundOnly:true,issue?}；保存target不能隐式启动。Client既在首页资源computer-use注册管理页，也在conversation.input.left添加电脑操作按钮（有sessionId时）；按钮popOver目标/启动/停止与打开管理。管理页不新建一级菜单。

驱动binary只放忽略的runtime缓存及构建lib/runtime，源码放资产SHA/provenance和准备脚本。build/install保留依赖私有资源；不拷贝第二份锁文件。Windows x64完成本机实测，VM协议夹具+换机清单，不假报真实VM已测。
