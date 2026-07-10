---
"@hyperdx/app": minor
"@hyperdx/api": minor
---

feat(dashboards): overlay alert firing/recovery markers on tile charts

Adds an optional "alert annotations" overlay to dashboard timeseries tiles.
When enabled via the dashboard menu ("Show alert annotations"), tiles that have
an alert draw a red vertical marker at the moment the alert fired and a green
marker when it recovered, so alert events can be correlated with the chart in
one view. The overlay is off by default and its state lives in the URL
(`?alertAnnotations=true`), not on the saved dashboard. Backed by a new
team-scoped `GET /api/alerts/:id/history` endpoint that returns only alert state
transitions within the requested time range, so annotations honor the
dashboard's selected window.
