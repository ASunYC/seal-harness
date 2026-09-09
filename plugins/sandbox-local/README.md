# @seal-harness/sandbox-local

Provides the process-confinement seam. Linux prefers a functionally probed bubblewrap backend and
falls back to the packaged Landlock launcher; macOS uses Seatbelt; Windows uses DeepSeekHarness's
published ACL restricted-token runner. An explicit runner can be configured on any platform.
Missing confinement fails closed.
