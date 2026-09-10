---
'@hyperdx/app': minor
---

Create and edit alerts from the chart explorer, without a saved search or dashboard tile. Build a chart on `/chart` (logs, traces, or metrics — builder or raw SQL), add an alert, name it, and create it; the alert persists its own chart config. On the alerts page these alerts show their name with a chart icon and link back to the explorer seeded with their query, and the alert detail page renders that query and edits both the alert's fields and the chart behind it in the full chart editor.
