---
"@hyperdx/hdx-eval": minor
---

Add a Parquet-snapshot fast-seed path for the MCP eval suite (Milestone 2 — kill the seed bottleneck). Full-volume seed generation is a CPU-bound JS loop that takes hours; the snapshot path generates the data once, exports each eval table to Parquet, and on later runs loads the Parquet straight into ClickHouse (I/O-bound, ~an order of magnitude faster). New CLI commands: `export-snapshot`, `load-snapshot`, and `seed-logic-hash`. Rollup metadata tables repopulate automatically via the existing materialized views on load (then OPTIMIZE FINAL for deterministic state). In CI the snapshot is stored in an `actions/cache` entry keyed on a hash of the seed-generation source, so it is reused across runs and regenerated only when the seeding logic changes.
