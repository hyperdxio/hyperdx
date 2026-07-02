# telemetry-generator

Synthetic telemetry for local dev and e2e testing of HyperDX. Emits **realistic
OTLP traces** and **coherent metric exemplars** so exemplar features (and
anything else needing good test data) can be built and validated against
data that actually agrees with itself.

## What it produces

- **Traces** (via OTLP gRPC → the dev collector → ClickHouse): six services
  (`api-gateway`, `order-service`, `user-service`, `search-service`,
  `payment-service`, `notification-service`), weighted attribute pools
  (`http.route`, `http.method`, `host.region`, `app.tenant_id`, `app.build_id`,
  `app.platform`, `app.feature_flag`, `k8s.pod.name`, `user.id`), nested
  db/cache/downstream spans, and several failure scenarios (slow checkout,
  iOS order errors, Redis timeout, Elasticsearch timeout, auth memory leak,
  payment timeout, compliance overhead) with gaussian latency distributions.
- **Metrics, fully via OTLP**: the generator emits *only* traces. The
  collector's **`spanmetrics` connector** derives `calls` (sum) and `duration`
  (histogram, ms) from those spans, **with exemplars enabled** — so the
  histogram data points carry `trace_id`/`span_id` pointing back at the exact
  spans they were measured from. The ClickHouse exporter writes them to
  `otel_metrics_histogram` / `otel_metrics_sum` with `Exemplars.*` populated.
  Nothing is written to ClickHouse directly; everything flows through the real
  pipeline.

Backfills `GEN_BACKFILL_MINUTES` of history on startup, then emits live at
`GEN_RATE_PER_SEC`.

## How the metrics get exemplars

The `spanmetrics` connector is bundled into the collector
(`packages/otel-collector/builder-config.yaml`) and wired up in
`packages/api/src/opamp/controllers/opampController.ts`, gated on the
`ENABLE_SPAN_METRICS` env flag (on in dev via `packages/api/.env.development`,
off by default so production behavior is unchanged). It reads span attributes as
metric dimensions (`http.route`, `http.method`, `host.region`, `app.tenant_id`,
`http.status_code`) and emits a duration histogram with `exemplars.enabled`.

Chart the **`traces.span.metrics.duration`** metric (histogram) on a Metric
source and the exemplar overlay resolves against the trace source — coherent by
construction because the metric *is* derived from the traces. (`span_metrics`
also emits `traces.span.metrics.calls`, a request-count sum.)

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | OTLP HTTP base (`/v1/traces` appended) |
| `GEN_OTLP_API_KEY` | `super-secure-ingestion-api-key` | ingest token (HyperDX `bearertokenauth`, raw scheme) |
| `GEN_BACKFILL_MINUTES` | `30` | history to backfill on startup |
| `GEN_RATE_PER_SEC` | `20` | live request rate |

## Run

Runs automatically with `yarn dev` (see the `telemetry-generator` service in
`docker-compose.dev.yml`). Standalone:

```bash
cd telemetry-generator && npm install
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:30996 npm start
```
