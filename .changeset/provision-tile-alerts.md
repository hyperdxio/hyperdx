---
'@hyperdx/api': minor
---

feat: provision tile alerts from dashboard files

The dashboard file provisioner stored a tile's `config.alert` inside the tile
but never created the alert, so a provisioned alert passed validation and never
fired. It now creates or updates each declared tile alert on every sync,
validated the same way the dashboards API validates them, and flags it
`provisioned: true`.

A provisioned alert is deleted once its tile, or its file entry, no longer
declares it. An alert that fails validation is skipped with a warning and keeps
its last valid version. Alerts created in the app on a provisioned dashboard are
not touched unless the file declares an alert on the same tile.
