---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

feat(charts): choose the range the Series Limit ranks over

A time chart with a Series Limit picks its top N series from the most recent
part of the time range, so a series with no recent events was dropped even when
it was the largest overall. Display Settings now has a "Rank series over"
option: "Most recent window" (the default, unchanged behaviour) or "Full range".
The option is also available as `seriesLimitRankingRange` in the external API
and MCP, and the Series Limit descriptions now say how the ranking works.
