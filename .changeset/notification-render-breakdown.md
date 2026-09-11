---
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: show only the delivery time in an alert's notification duration

The notification duration on an alert's evaluation list was timing everything an alert does once it decides to fire: building the message title and links, querying the log lines that go in the body, rendering the template, and then delivering it. That made the column read in seconds while the webhook underneath it answered in milliseconds — the column and its own per-target breakdown disagreed, and the figure was dominated by work that has nothing to do with how fast the notification target responded. It now times the delivery alone. Evaluations already recorded keep their old figure and will read high.
