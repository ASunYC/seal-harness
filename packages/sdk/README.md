# @seal-harness/sdk

High-level TypeScript client that owns a Seal Harness RPC subprocess, exposes reusable sessions,
streams runtime notifications, and performs bounded graceful shutdown.

```ts
import { SealHarness } from "@seal-harness/sdk";

await using harness = new SealHarness({ provider: "deepseek", model: "deepseek-chat" });
const result = await harness.run("Explain this repository");
console.log(result.finalResponse);
```
