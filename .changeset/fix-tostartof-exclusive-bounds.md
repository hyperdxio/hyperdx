---
"@hyperdx/common-utils": patch
---

fix: Keep toStartOf\* time filter bounds inclusive when dateRangeEndInclusive is false, preventing data from being dropped past hour/minute boundaries in time histograms
