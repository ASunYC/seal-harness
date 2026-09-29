# 界面来源

知识库界面移植自 AgentEarth Stratex，提交 `070ba39e82a4d47dec812870b691eedcb7f7b28e`。
来源保持只读；保留仓库已有 Stratex attribution 和第三方许可。

- `src/renderer/src/features/vault/VaultLibraryView.vue` → `src/panel.jsx`
- `VaultLibraryCollections.vue`、`components/capabilities/CapabilityFeaturedScenes.vue`、`CapabilityCatalogSection.vue` → `src/catalog.jsx`
- `VaultLibraryCollectionDetailDialog.vue`、`VaultLibraryDialogs.vue`、`VaultLibraryFileDropZone.vue` → `src/detail.jsx`、`src/ui.jsx`
- `VaultKnowledgeShareDialog.vue`、`VaultCollectionGrantMembers.vue` → `src/sharing.jsx`
- `VaultKnowledgeServiceSelector.vue` → `src/services.jsx`
- `VaultDialogShell.vue` → `src/ui.jsx`
- 上述组件 scoped CSS 与 `vault-library-collections.css` → `src/source-styles.js`（只添加 `.zz-knowledge` 作用域并展开 Vue `:deep`）

布局、目录层级、场景/资料卡片、资料详情、上传队列、预览抽屉和服务管理取自来源。
渲染器改用已安装 React；原生 dialog 负责模态焦点、Esc 与还焦。
保留Seal Harness既有 Connection RPC、资料集分类字段、上传协议、服务配置、权限和会话草稿引用。
Seal Harness独有检索保留为资料详情第三个 tab；文件分类沿用资料集，服务配置不写死来源内网 IP。
未复制没有 LibraryView 入口的 prototype 页面与已停用单文件安装/分享/移动分支。

图标直接使用 `../capability-shared/src/icons.jsx` 的 AppIcon / Lucide 1.31.0 节点及场景映射；许可和节点来源见共享目录的 `src/icon-data.js` 与 `src/lucide-LICENSE`。来源字符图标按产品要求转成 SVG，保留原按钮文字与无障碍名称。
