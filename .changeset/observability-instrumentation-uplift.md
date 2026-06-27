---
'@hyperdx/api': minor
---

Improve API observability instrumentation. Add a centralized tracing + metrics
helper library (`withSpan`, `setBusinessContext`, `getStaticFeatureFlags`,
memoized `getCounter`/`getHistogram`, `recordDuration`), attach consistent
team/user/feature-flag context to traces across all auth paths (session,
access-key, local mode), and add custom metrics for previously log-only hot
paths: API errors, alert evaluation outcomes/query/process failures, and
external API search/charts query duration and errors.
