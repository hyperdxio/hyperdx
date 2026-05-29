---
'@hyperdx/api': minor
'@hyperdx/app': minor
'@hyperdx/otel-collector': minor
---

fix(otel-collector): allow `CUSTOM_OTELCOL_CONFIG_FILE` to override the
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
