---
"@hyperdx/otel-collector": patch
---

fix(otel-collector): skip string severity inference when JSON body has a
`level`/`severity` field

When the log body parsed as JSON and contained a level-like field, the
pipeline still ran its `\b(alert|crit|emerg|fatal|error|err|warn|notice|debug|dbug|trace)`
keyword scan over the raw body string. The leading-only `\b` boundary
matched any word starting with a severity keyword, so bodies containing
words like `alertmanager`, `alerting`, `errors`, `warning`, etc. produced
the wrong severity. A Grafana sidecar log with body
`{"level":"INFO", "msg":"... mimir-alertmanager-dashboard ..."}` was being
tagged `SeverityText="fatal"`, `SeverityNumber=21` because `alert` matched
inside `alertmanager`, even though the JSON `level` said `INFO`.

A new OTTL `log_statements` block in
`docker/otel-collector/config.yaml` runs between the existing JSON-parse
block and the string-inference block. It promotes a JSON-derived level
field (now in `log.attributes`) to `log.severity_text`, which causes the
string-inference block to be skipped via its existing
`severity_number == 0 and severity_text == ""` guard. The block is
case-insensitive across keys by enumerating common casings of common field
names used by mainstream logging frameworks: `level` / `Level` / `LEVEL`
(pino, winston, zerolog, zap, logrus, slog, Serilog, NLog),
`severity` / `Severity` / `SEVERITY` (Datadog, GCP Cloud Logging), and
`log.level` (Elastic ECS, flattened from nested JSON). Each `set`
self-guards on `severity_text == ""` so the first match wins (priority:
`level` > `severity` > `log.level`). The block as a whole is gated on no
producer-set severity, so explicit producer values are always preserved.

`severity_number` is mapped via case-insensitive `(?i)` regex over
`severity_text`, mirroring the existing string-inference keyword set.
Unrecognized values (e.g. `"verbose"`) fall back to `INFO`, matching
block 2's else-branch. The existing `ConvertCase(severity_text, "lower")`
normalization is unchanged.

Behavior preserved for: non-JSON bodies, JSON bodies without a level
field, and any log record where the producer already set
`severity_text` or `severity_number`.

Fixes HDX-4383.
