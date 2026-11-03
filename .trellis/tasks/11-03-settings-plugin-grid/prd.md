# 内置插件页布局

截图内插件列表只占左侧：内部ui-settings-plugin-inventory root保留760px cap，卡片固定2列。仅产品设置plugins作用域移除该cap，搜索/分组跟内容同宽；按实际inventory容器宽度1/2/3/4列，closed cards统一最小高度及padding，展开卡片不拉长邻卡。保留搜索、preset选择、展开详情、插件市场tab及visited/hidden语义，不改插件业务/启停。

通过公开data-slot/aria-busy/data-plugin-scope/data-plugin-module选择器和匿名container query，不依赖CSSmodulehash或编辑只读子模块。不改变其他设置页。

验收：宽屏1～4列/窄窗单列，无右侧遗留宽cap/横向溢出，搜索和展开/tab返回正常，浅深主题沿原语义色；现有navigation测试及真实DOM测量/截图。不提交/推送。

## 完成结果

产品CSS调整完成，原生业务与只读子模块未改。9项navigation既有回归通过，产品verify通过，Renderer健康无插件导入失败。初次运行中重装遇到Windows包目录占用，已停机完成装配并verify后启动。

实际宽度1920/1440/1100/700对应4/3/2/1列，inventory宽1574/1094/754/406，分别等于可用内容宽；normal卡片高度133px一致，无横向溢出。展开邻卡高度保持、persona搜索、插件市场往返保留搜索/展开状态通过，测试query已清空。

日志.build/settings-plugin-grid-{build,tests,smoke}.log与安装日志，截图settings-plugin-grid-wide.png/narrow.png。未提交/推送。
