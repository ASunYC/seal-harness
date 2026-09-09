# @seal-harness/subagent-tools

Provides durable background child Agents and the `spawn_agent`, `list_agents`, `wait_agents`,
`send_message`, `interrupt_agent`, and legacy `abort_agent` tools. Child ownership is recorded
in Session metadata so completed children remain discoverable after restart.

The DeepSeekHarness-compatible control surface uses `agent_id`, supports `list_agents` scopes
`children` and `descendants`, permits messages across an exact parent/child edge in either
direction, and permits an ancestor to interrupt any transitive descendant without deleting its
durable Session.
