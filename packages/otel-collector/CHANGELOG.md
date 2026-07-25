# @hyperdx/otel-collector

## 2.31.0

## 2.30.1

## 2.30.0

### Minor Changes

- 727d3274: Add an opt-in Datadog receiver (gated behind `ENABLE_DATADOG_RECEIVER`) so a
  Datadog Agent can ship traces, metrics, and logs to HyperDX. The contrib
  `datadogreceiver` is compiled into the collector binary and, when enabled, the
  OpAMP controller attaches it (listening on `0.0.0.0:8126`) to the traces,
  metrics, and logs pipelines. When collector authentication is enforced, the
  receiver validates the `DD-API-KEY` header against team API keys.
- 3f1e1fe4: feat: update metrics schema for more efficient PK and time pruning

## 2.29.0

### Minor Changes

- 34a855969: chore(otel-collector): bump base collector to v0.154.0

  Upgrade the custom OTel Collector base from contrib v0.149.0 (core 1.55.0) to
  v0.154.0 (core 1.60.0). Updates `OTEL_COLLECTOR_VERSION` /
  `OTEL_COLLECTOR_CORE_VERSION` in `.env`, both Dockerfile ARG defaults, and the
  smoke-test compose fallbacks.

  Compatibility: no config changes required. Reviewed contrib and core breaking
  changes across v0.150–v0.154 against every component HyperDX uses. All affected
  upstream changes are either backward-compatible deprecation aliases
  (`prometheusremotewrite`, `resourcedetection`), explicit-config no-ops for
  HyperDX (clickhouse exporter already sets `json:` directly; transform/routing
  connectors set `error_mode: ignore` explicitly), or internal core feature-gate
  stabilizations.

- 6b6c340fc: chore(otel-collector): bump base collector to v0.155.0

  Upgrade the custom OTel Collector base from contrib v0.154.0 (core 1.60.0) to
  v0.155.0 (core 1.61.0). Updates `OTEL_COLLECTOR_VERSION` /
  `OTEL_COLLECTOR_CORE_VERSION` in `.env`, both Dockerfile ARG defaults, and the
  smoke-test compose fallbacks.

  Compatibility: no config changes required. Reviewed contrib and core breaking
  changes for v0.155.0 against every component HyperDX uses. The removed
  `telemetry.UseLocalHostAsDefaultMetricsAddress` core gate has no impact because
  the telemetry metrics endpoint is set explicitly (`host: 0.0.0.0`, `port:
8888`), and the `memory_limiter` metric rename does not affect the smoke tests
  (which assert on the startup log line and the `batch/lowlatency` metric label,
  not memory_limiter metrics). All other breaking changes are in unused components
  or internal feature-gate removals.

### Patch Changes

- 973d1201b: fix: polish promql experience across the app
- a5dfce4b: fix(otel-collector): only enable the prometheus remote-write exporter in
  standalone mode when `CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` is set

  The standalone collector config used to unconditionally declare a
  `prometheusremotewrite` exporter and a `metrics/promql` pipeline. When
  `CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` was unset the exporter rendered
  with an empty endpoint and every metrics batch failed to export.

  The exporter and pipeline have been moved to
  `docker/otel-collector/config.standalone.promql.yaml`, which is now only
  loaded by `entrypoint.sh` when `CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` is
  non-empty. This mirrors the OpAMP-managed gating in
  `packages/api/src/opamp/controllers/opampController.ts` (which already
  only adds the exporter when `IS_PROMQL_ENABLED` is true).

  No action required if `CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` is set; the
  behavior is unchanged. If it was unset, the collector now stops emitting
  the failing prometheus-remote-write attempts.

## 2.28.0

### Minor Changes

- 3123db53: feat: experimental promql support
- cb6a74ce: fix(otel-collector): allow `CUSTOM_OTELCOL_CONFIG_FILE` to override the
  default `memory_limiter`, `batch` (and other pipeline processors)

  Pipeline `processors:` lists used to be defined in the OpAMP remote config
  sent by the API (`packages/api/src/opamp/controllers/opampController.ts`).
  That meant the remote config overwrote any pipeline `processors:` list a
  user supplied via `CUSTOM_OTELCOL_CONFIG_FILE`, making it impossible to
  substitute the default `memory_limiter` with one configured for
  `limit_percentage`/`spike_limit_percentage` mode (#2145).

  The pipeline `processors:` lists now live in the bootstrap config
  (`docker/otel-collector/config.yaml` for supervisor mode, and
  `docker/otel-collector/config.standalone.yaml` for standalone mode). The
  OpAMP remote config no longer sets `processors:` on these pipelines, so the
  bootstrap+custom merge wins. Receivers and exporters are still configured
  dynamically by the OpAMP controller.

  To override `memory_limiter`, define a new processor with a different name
  in `CUSTOM_OTELCOL_CONFIG_FILE` and swap the pipeline `processors:` lists:

  ```yaml
  processors:
    memory_limiter/custom:
      check_interval: 5s
      limit_percentage: 75
      spike_limit_percentage: 25

  service:
    pipelines:
      traces:
        processors: [memory_limiter/custom, batch]
      metrics:
        processors: [memory_limiter/custom, batch]
      logs/out-default:
        processors: [memory_limiter/custom, transform, batch]
      logs/out-rrweb:
        processors: [memory_limiter/custom, batch]
  ```

  The default `memory_limiter` block defined in the base config is left in
  the merged config but is no longer referenced by any pipeline; the
  collector only instantiates `memory_limiter/custom` at runtime.

  The same swap pattern works for the `batch` processor (and any other base
  processor). For example, to lower the export timeout on a specific
  pipeline:

  ```yaml
  processors:
    batch/lowlatency:
      send_batch_size: 1000
      send_batch_max_size: 2000
      timeout: 500ms

  service:
    pipelines:
      traces:
        processors: [memory_limiter, batch/lowlatency]
      logs/out-default:
        processors: [memory_limiter, transform, batch/lowlatency]
  ```

  Lighter-weight env-var tuning is also available for the default `batch`
  processor without writing a custom config file:
  `HYPERDX_OTEL_BATCH_SEND_BATCH_SIZE`,
  `HYPERDX_OTEL_BATCH_SEND_BATCH_MAX_SIZE`, and `HYPERDX_OTEL_BATCH_TIMEOUT`.
  See the README for details.

### Patch Changes

- ad3f1c9e: fix(otel-collector): skip string severity inference when JSON body has a
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

## 2.27.0

## 2.26.0

## 2.25.0

### Minor Changes

- aaba3e95: feat: new optimized otel schema based on weeks of benchmarks.

  The Primary Key is now grouped by `toStartOfFiveMinutes`. At extremely large
  data sizes, it may be helpful to reduce granularity to 1 minute instead of 5.
  Bloom Filter indexes can be used instead, but full text search performs better
  across the board. Additionally, tests show that TimestampTime is effectively
  not necessary, which is especially true with data grouped by 5 minute
  boundaries by default.

## 2.24.1

### Patch Changes

- 11e1301c: feat(otel-collector): tune batch processor defaults for ClickHouse and make
  them configurable

  The bundled OTel Collector config now sets `processors.batch.send_batch_size`
  to `10000` and `timeout` to `5s` (was upstream defaults of `8192` / `200ms`),
  matching the values recommended by the ClickHouse exporter and ClickStack
  docs. The upstream defaults were too aggressive for ClickHouse — they
  produced very small inserts under low load, hurting insert performance and
  inflating the number of MergeTree parts.

  Each setting can also be overridden via environment variables:

  - `HYPERDX_OTEL_BATCH_SEND_BATCH_SIZE` (default: `10000`)
  - `HYPERDX_OTEL_BATCH_SEND_BATCH_MAX_SIZE` (default: `0`, meaning no upper
    bound)
  - `HYPERDX_OTEL_BATCH_TIMEOUT` (default: `5s`)

## 2.24.0

### Minor Changes

- 28f374ef: feat: Bump OTel Collector from 0.147.0 to 0.149.0

  Upgrade the OpenTelemetry Collector and all its components from v0.147.0 to
  v0.149.0 (core providers from v1.53.0 to v1.55.0).

- 28f374ef: feat: Migrate OTel Collector build to use OCB (OpenTelemetry Collector Builder)

  Replace the pre-built otel/opentelemetry-collector-contrib image with a custom
  binary built via OCB. This enables adding custom receiver/processor components
  in the future while including only the components HyperDX needs. The collector
  version is now centralized in `.env` via `OTEL_COLLECTOR_VERSION` and
  `OTEL_COLLECTOR_CORE_VERSION`, with `builder-config.yaml` using templatized
  placeholders substituted at Docker build time.

- 0a4fb15d: feat: Add missing core extensions, commonly-used contrib processors/receivers, and filestorage extension

  Add the two missing core extensions (memorylimiterextension, zpagesextension),
  12 commonly-used contrib processors (attributes, filter, resource, k8sattributes,
  tailsampling, probabilisticsampler, span, groupbyattrs, redaction, logdedup,
  metricstransform, cumulativetodelta), 4 commonly-used contrib receivers
  (filelog, dockerstats, k8scluster, kubeletstats), and the filestorage extension
  (used for persistent sending queue in the clickhouse exporter) to
  builder-config.yaml.

### Patch Changes

- cb841457: refactor: Deprecate clickhouse.json feature gate in favor of per-exporter json config

  Replace the upstream-deprecated `--feature-gates=clickhouse.json` CLI flag with
  the per-exporter `json: true` config option controlled by
  `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_JSON_ENABLE`. The old
  `OTEL_AGENT_FEATURE_GATE_ARG` is still supported for backward compatibility but
  prints a deprecation warning when `clickhouse.json` is detected.

- 7953c028: feat: Add between-type alert thresholds

## 2.23.2

## 2.23.1

## 2.23.0

## 2.22.1

### Patch Changes

- 470b2c29: ci: Replace QEMU with native ARM64 runners for release builds

## 2.22.0

## 2.21.0

### Patch Changes

- 53a4b672: chore: update otel collector base image to 0.147.0

## 2.20.0

## 2.19.0

### Patch Changes

- 2c306b69: fix: support tcp with TLS (tcps/tls schemes) and ?secure=true query param in otelcol migrator

## 2.18.0

### Minor Changes

- 4c42fdc3: fix: improve log level extraction with word boundaries in regex

### Patch Changes

- 36da6ff4: chore: bump base alpine 3.23 to address CVE-2025-15467

## 2.17.0

### Patch Changes

- 18c2b375: fix: Fallback to legacy schema when CH JSON feature gate is on
- 629fb52e: feat: introduce HYPERDX_OTEL_EXPORTER_TABLES_TTL to support custom TTL configuration
- baf18da4: feat: add TLS support for OTel collector migration script
- baf18da4: chore: bump otel collector version to v0.136.0
- 18c2b375: fix: support OTEL_AGENT_FEATURE_GATE_ARG in opamp-less mode

## 2.16.0

## 2.15.1

### Patch Changes

- 3dae0e01: fix: copy otel-collector schema directory to AIO image

## 2.15.0

### Minor Changes

- 6f4c8efb: feat: Enforce ClickStack schemas by default

### Patch Changes

- c2a61933: feat: add OTLP auth token support for standalone mode
- 683ec1a8: fix: add TLS parameters for https ClickHouse endpoints in goose DB string

## 2.14.0

### Patch Changes

- 43de4678: feat: allow otel-collector to run without OpAMP server
