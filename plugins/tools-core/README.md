# @seal-harness/tools-core

工具注册和执行管线。每次执行都会验证输入并经过 `PolicyService`；`ask` 决策必须
由 `ApprovalService` 明确允许，否则失败关闭。
