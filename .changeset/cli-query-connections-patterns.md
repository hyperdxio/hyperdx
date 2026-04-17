---
"@hyperdx/cli": minor
---

Add `hdx query` and `hdx connections` commands for agentic ClickHouse workflows:

- **`hdx connections`** — list ClickHouse connections (`id`, `name`, `host`) for the authenticated team. Supports `--json` for programmatic consumption.
- **`hdx query --connection-id <id> --sql <query>`** — run raw SQL against a configured ClickHouse connection via the `/clickhouse-proxy`. Default `--format` is `JSONEachRow` (NDJSON); any ClickHouse format is accepted. Exit codes: `0` on success (empty stdout = zero rows), `1` on failure. On error, a lazy connection lookup distinguishes "unknown connection ID" from "bad SQL".
- **`hdx query --patterns`** — post-process the result with the Drain algorithm (`@hyperdx/common-utils/dist/drain`) and emit one NDJSON pattern object per cluster, sorted by count desc: `{"pattern":"<template>","count":<n>,"sample":"<first sample>"}`. Use `--body-column <name>` to cluster a single column's string value; defaults to the whole row JSON-serialized so any SELECT shape works.
- `--help` documents the exit-code contract and includes sampling guidance (`ORDER BY rand()` + selective WHERE warning) for mining over large tables.
