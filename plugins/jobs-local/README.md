# @seal-harness/jobs-local

Tracks cancellable process-local background work with per-Session ownership. Producers register
jobs through `JobService`; Agents inspect and control their own jobs through `job_list`,
`job_output`, `job_wait`, and `job_kill`.

`job_output` accepts the DeepSeekHarness-compatible `wait` and `timeout_ms` options, and
`job_kill` accepts an optional cancellation `reason`. `job_wait` remains available as a
Seal Harness convenience extension.

Completed jobs are injected into a busy owning Agent. With the default `completionDelivery:
"wakeup"`, an idle owner is also resumed automatically; `maxConsecutiveWakes` (default `3`)
bounds completion-triggered turns until the next human-authored message. Set
`completionDelivery: "quiet"` to persist notices for the next ordinary turn without waking
an idle owner.
