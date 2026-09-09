# @seal-harness/spill-local

Stores oversized plain-text tool results in private, Session-scoped files. Files use unpredictable names and exclusive owner-only writes. A best-effort startup sweep removes expired regular files while leaving symlinks and unrelated entries alone.
