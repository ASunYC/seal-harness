# @seal-harness/feedback-tools

Registers `/feedback` for session-level remarks and provides optimistic-concurrency per-assistant-message ratings/notes. Notes default to the DeepSeek Web limit of 8192 UTF-8 bytes. Message feedback is stored in an atomic, session-identity-bound JSON sidecar so it never enters model history or telemetry.
