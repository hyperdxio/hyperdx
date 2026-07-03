---
"@hyperdx/api": patch
---

fix(api): bound alert history lookback by check interval

`getPreviousAlertHistories` scanned a fixed 7-day window per alert per tick. Size the narrow lookback from each alert's interval (with a floor and 7-day fallback when empty) to cut MongoDB index scans on the hot path.
