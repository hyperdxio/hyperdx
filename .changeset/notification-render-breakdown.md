---
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: account for message render time in the alert notification breakdown

The notification duration on an alert's evaluation list measures the whole
notification phase, but the expanded breakdown only listed per-target dispatch
times. With a single target the two figures should match, and instead the
target read as milliseconds against a multi-second total — the missing time was
spent building the message (title, links, the query for log lines in the body)
before anything was dispatched. That share is now recorded and shown as its own
row, so the expansion accounts for the total and a slow notification points at
whichever phase is actually slow.
