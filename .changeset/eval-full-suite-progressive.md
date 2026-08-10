---
"@hyperdx/hdx-eval": minor
---

Run the whole MCP eval suite (all scenarios) in one CI job at a reduced volume factor (0.5) with a live-updating PR comment. The runner now loops every scenario into a single shared batch (new `run --batch <dir>` option), grading each inline and dropping its ClickHouse tables afterward to keep the database small, then aggregates one verdict across the suite. After each scenario it re-renders the verdict and upserts a single sticky PR comment (new `report-pr --progress` note + `⏳ RUNNING` badge) so progress is visible live instead of only at the end. The Parquet snapshot cache is now keyed for the whole suite, and the default snapshot generation volume factor drops to 0.5 (≈2–4 GB, comfortably under the actions/cache cap) — a subset that preserves eval difficulty for proportional-signal scenarios.
