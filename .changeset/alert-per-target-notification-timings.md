---
'@hyperdx/api': minor
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

Record and show which notification target an evaluation's delivery time went to. `webhookDurationMs` was a single number covering the whole delivery, and because targets are dispatched concurrently the slowest one sets it — so a multi-target alert reported a figure with no way to tell which webhook was responsible, or that the other targets were fine.

Each dispatch is now timed individually and aggregated per target across the evaluation, since a grouped alert notifies the same target once per firing group and again on resolve. One entry per distinct target carries its summed duration, how many dispatches it took, and how many failed. The evaluation history's "Notification duration" cell expands in place to show the breakdown.

Stored per evaluation rather than per dispatch: a 50-group alert notifying 10 targets would otherwise write 500 entries onto every history row. The array is capped at `ALERT_NOTIFICATION_TARGETS_LIMIT` and sorted slowest-first, so the cap drops the least interesting rows. Records written before this change keep rendering their total with nothing to expand.
