---
'@hyperdx/api': minor
---

feat: provision tile alerts from dashboard files

The dashboard file provisioner stored a tile's `config.alert` inside the tile
but never created the alert, so a provisioned alert passed validation and never
fired. It now creates or updates each declared tile alert on every sync, flagged
`provisioned: true`, after the checks the alerts API applies plus the ones the
alert task needs to evaluate it (display type, no PromQL, and a source,
connection and webhooks in the team).

Channels can name their webhook with `webhookName`, resolved per team on each
sync, instead of a `webhookId` that only exists in one install.

A provisioned alert is deleted once its tile, or its file entry, no longer
declares it, and when its dashboard's file is removed or the dashboard is
renamed. An alert that fails validation is skipped with a warning, and its tile
keeps its last synced version. Alerts created in the app are never changed or
deleted.
