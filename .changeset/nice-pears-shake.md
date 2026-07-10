---
'@hyperdx/cli': minor
---

Add terminal charting to the CLI, built on the same renderChartConfig SQL
pipeline as the web dashboards:

- Interactive Dashboards page in the TUI (`d` key) with tile navigation,
  fullscreen tiles, time-range editing, and refresh
- `hdx chart` command for troubleshooting from the terminal (including by
  AI agents): render saved dashboard tiles (`-d/-t`), ad-hoc builder charts
  (`-s <source>` with `--agg/--value/--where/--group-by/--series`), or ad-hoc
  raw SQL (`--sql` with `$__timeFilter`/`$__timeInterval` macros)
- Supported chart types: line, stacked bar, number, table, bar, pie, and
  markdown; flexible time ranges (`--since 1h`, `--from now-24h`, ISO dates);
  `--json` output for structured consumption; ANSI colors auto-stripped when
  piping (`--color auto|always|never`)
