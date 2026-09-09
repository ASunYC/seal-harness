# seal-harness Python SDK

```python
from seal_harness import SealHarness

with SealHarness(provider="deepseek", model="deepseek-chat") as harness:
    result = harness.run("Explain this repository")
    print(result.final_response)
```

The SDK owns a `seal-harness-rpc` subprocess, supports reusable named sessions, notification
callbacks, and independent filtered subscriptions:

```python
subscription = harness.client.subscribe_session_tree("session-id")
notification = subscription.next(timeout=5)
subscription.close()
```

Normal requests have no timeout unless `request_timeout` is configured. Initialization failures
are retryable with a fresh subprocess, while final shutdown is idempotent and bounded through
protocol shutdown, stdin EOF, terminate (POSIX), and kill stages.
