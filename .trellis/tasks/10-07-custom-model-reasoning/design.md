# 设计

上游 `ui-settings-models` 仅编辑模型 ID、名称、容量和输入类型；`llm-pi-ai` 已支持逐模型 `reasoningEfforts`。借其公开 `settings.models.footer` 槽，在产品自有 Client 插件增加配置卡。读取公开 `remote.settings.describe()` 的 `llm-pi-ai` namespace，仅投影模型标识和推理映射。保存使用 `remote.settings.mutate('llm-pi-ai', [{op:'set',path:['providers',provider,'models'],value:...}], revision)`，以完整当前模型数组保留未知字段；版本冲突要求刷新。档位集合来自适配器支持的标准标识，wire 值由用户填入；只有 `off` 可留空以表达不发送字段。用已安装适配器校验实际模型元数据，不直接改上游或复刻适配器。

不自动推断远端模型的能力，也不向远端发送探测调用。公开目录模型若没有显式 `models` 数组，暂不从此卡新增覆盖；本轮覆盖手动配置的模型列表。
