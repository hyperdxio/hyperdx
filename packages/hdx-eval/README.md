# @hyperdx/hdx-eval

Synthetic telemetry data generators for the HyperDX observability eval
framework. Phase 1 deliverable: deterministic, planted-anomaly traces and
logs across three investigation scenarios.

## Scenarios

- `error-root-cause` — checkout 5xx spike caused by a `payment-service` →
  DB connection timeout, propagated up through `checkout-api`.
- `latency-spike` — `api-server` p99 jump on `GET /api/orders/search` for
  enterprise tenants (slow `database.query` child span).
- `noisy-signals` — log volume dominated by 3 patterns: `inventory-service`
  heartbeats, `notification-service` cache-hit chatter, `worker`
  caught-exception stack traces.

Each scenario writes into its own ClickHouse tables in the `default`
database: `eval_<scenario>_otel_traces` and `eval_<scenario>_otel_logs`.
Schema mirrors HyperDX's `otel_traces` / `otel_logs` exactly via
`CREATE TABLE ... AS otel_traces`.

## Usage

Pre-req: `yarn dev` running so `default.otel_traces` and
`default.otel_logs` exist (created by the OTel collector migrations).

```bash
# List scenarios + their tables
yarn workspace @hyperdx/hdx-eval dev list

# Seed a scenario (default seed=42, now=Date.now())
yarn workspace @hyperdx/hdx-eval dev seed error-root-cause
yarn workspace @hyperdx/hdx-eval dev seed latency-spike --seed 7
yarn workspace @hyperdx/hdx-eval dev seed noisy-signals \
  --now 2026-05-08T15:00:00Z

# Drop a scenario's tables
yarn workspace @hyperdx/hdx-eval dev drop error-root-cause
```

Connection defaults to `http://localhost:${HDX_DEV_CH_HTTP_PORT}` (set by
`scripts/dev-env.sh`); override with `--ch-url`.

After seeding, manually create a HyperDX Source pointing at the eval
tables (one-time per scenario) so the HyperDX MCP server can query them.

## Determinism

All randomness flows through a `mulberry32(seed)` PRNG. Same `(seed, now)`
produces byte-identical row content. This is what makes side-by-side
comparison of MCP A vs MCP B meaningful.

## Tests

```bash
yarn workspace @hyperdx/hdx-eval ci:unit
```

Unit tests verify (a) PRNG determinism and (b) each scenario's planted
anomaly invariants hold in the generated rows (no ClickHouse needed).
