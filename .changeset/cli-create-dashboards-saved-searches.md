---
'@hyperdx/cli': minor
---

Add dashboard and saved-search authoring commands to the CLI:

- `hdx dashboards list` (default subcommand) gains `--query` name filtering and `--format table|json|csv`
- `hdx dashboards export --id <id-or-name>` prints a dashboard definition as JSON, round-trip compatible with import
- `hdx dashboards create` accepts either a full definition (`--file <json>`) or inline charts (`--name` + repeatable `--chart` / `--chart-file`, with automatic grid layout), plus `--if-not-exists`
- `hdx dashboards import --file <json>` recreates an exported dashboard, with `--if-not-exists` and `--name-override`
- `hdx saved-searches` command group: `list` and `create` (`--name/--source/--where/--where-language/--select/--order-by/--tags`)

Definitions are validated locally against the shared schema before being sent, and missing tile ids are generated automatically. Also fixes `getSavedSearches()` to call the correct `/saved-search` API path (the previous `/saved-searches` path always returned 404).
