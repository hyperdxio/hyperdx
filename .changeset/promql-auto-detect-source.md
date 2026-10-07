---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

feat: auto-detect a PromQL source during onboarding

When PromQL is enabled (`NEXT_PUBLIC_ENABLE_PROMQL=true`), onboarding source auto-detection now also creates a PromQL source for a ClickHouse TimeSeries engine table. It prefers a table named `metrics_ts` and otherwise picks the only TimeSeries table on the connection. A service with only a TimeSeries table is no longer sent to manual source setup.
