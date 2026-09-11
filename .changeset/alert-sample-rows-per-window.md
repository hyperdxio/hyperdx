---
'@hyperdx/api': patch
---

fix: fetch a grouped alert's example log lines once per window

A saved-search alert puts a handful of example log lines into the notification it sends, and fetching them takes a second query. That query was being made while building each message, so an alert grouped by service asked ClickHouse for the same lines once per breaching service — ten services meant ten identical queries over the same data, because the query only filters by the saved search and the time window, never by the group. It now runs once and every notification for that window shares the answer. An alert catching up on skipped ticks still fetches lines for each window it backfills, since those genuinely differ. Ungrouped alerts are unaffected; they only ever asked once.
