---
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

feat: show live ClickHouse query progress while a search runs

The results table footer and the histogram's "Scanned Rows | Elapsed Time" strip
now report rows read and percent complete as the query streams, measured against
the whole selected date range rather than the window currently in flight.
Requires ClickHouse 25.1+ (for `JSONEachRowWithProgress` metadata events); older
servers keep the previous non-streaming behavior.
