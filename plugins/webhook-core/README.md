# @seal-harness/webhook-core

Provider-neutral registry for trusted webhook rules. Dispatch snapshots a verified JSON delivery and starts all matching rules without waiting. A non-null rule result creates and prompts a fresh root Session in an existing absolute workspace directory.

Provider authentication belongs in adapter packages such as `@seal-harness/webhook-github`. Configure `defaultModel` unless every rule supplies an explicit model.
