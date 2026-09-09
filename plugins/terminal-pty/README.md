# @seal-harness/terminal-pty

Provides real persistent pseudo-terminal sessions backed by `node-pty`. Terminals are owned by
the calling Session, registered as background jobs, bounded in memory, and controlled with
`terminal_start`, `terminal_send`, `terminal_read`, `terminal_list`, and `terminal_kill`.
