# @seal-harness/goal-round-driver

Continues active, armed goals in the same Session after the current run becomes durable. Each
admitted continuation increments `roundsStarted`, retains a `<goal_round>` user prompt, and uses
the Session's last model and working directory. The configured goal cap is converted into a
durable `round-limit` blocker.
