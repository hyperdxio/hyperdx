---
'@hyperdx/api': patch
'@hyperdx/otel-collector': patch
---

fix(otel-collector): allow `CUSTOM_OTELCOL_CONFIG_FILE` to swap the default
`memory_limiter` (and other pipeline processors)

Pipeline `processors:` lists used to be defined in the OpAMP remote config
sent by the API (`packages/api/src/opamp/controllers/opampController.ts`).
That meant the remote config overwrote any pipeline `processors:` list a
user supplied via `CUSTOM_OTELCOL_CONFIG_FILE`, making it impossible to
substitute the default `memory_limiter` with one configured for
`limit_percentage`/`spike_limit_percentage` mode (HDX-4090).

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
