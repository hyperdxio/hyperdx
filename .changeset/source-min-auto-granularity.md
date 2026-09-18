---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
'@hyperdx/api': patch
---

Add a per-source floor for "Auto Granularity". A metric source can now set "Minimum Auto Granularity" (Team Settings → Sources → your Metrics source) so that auto-inferred time buckets never go below it — useful when the underlying metric is reported on a fixed interval (e.g. a 60s scrape), since a short selected date range can otherwise auto-infer a smaller bucket than that interval and render a sparse/steppy series (alternating real-sample/empty buckets). Mirrors Grafana's per-datasource "Min interval" setting. Unset (the default) preserves the existing unfloored behavior, and an explicit (non-"Auto") granularity chosen on a tile is never affected.
