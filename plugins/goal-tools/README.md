# @seal-harness/goal-tools

Provides a durable, revision-checked goal state machine scoped to one Session and the
`get_goal`, `create_goal`, and `update_goal` tools. Goal snapshots are appended to the owning
Session log; process-local continuation activation is deliberately not persisted.
