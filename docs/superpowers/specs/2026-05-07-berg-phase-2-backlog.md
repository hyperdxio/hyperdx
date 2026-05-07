# Berg Phase 2 — Backlog

**Status:** Scope-only document. Each item below is "we want this; we haven't designed it yet." A full design spec lands when an item is picked up.

**Spec:** [`docs/superpowers/specs/2026-05-04-berg-design.md`](./2026-05-04-berg-design.md) is the canonical Berg architecture. Phase 1.x specs cover the Trino port. This Phase 2 backlog is the next slice of feature work after the port stabilises.

---

## Items

### 1. Materialised-view auto-routing on read

Berg already lets users query MVs directly — pointing a `Source` at an MV-backed Glue table is enough. What's missing is *automatic* routing: when a base table has a faster MV alongside it, reads should rewrite to the MV when query predicates are compatible. The HyperDX/CH-era `getKeyValuesWithMVs` did this for ClickHouse; it was deleted during Phase 1 because CH's `system.tables` introspection and CH-specific MV semantics don't translate.

**Value:** an order-of-magnitude faster `getKeyValues` and chart reads on big tables when an aggregated MV exists.

**Rough scope (one-day-ish, not designed yet):**
- Extend `Source` with an `mvOf` field (or a generalised `parents: { kind: 'mv'|'rollup', source: id }[]`) so an MV-Source declares its base.
- Teach the metadata helpers (`getKeyValues` and the equivalent chart-side fallbacks) to prefer the MV-Source when query predicates are a subset of the MV's `GROUP BY`.
- Glue-side schema check: MV columns must be a superset of the columns the read needs; otherwise fall back to the base.
- UI: a "view via MV (faster)" indicator in the row-table header so users understand what they're seeing.

**Open questions:**
- Athena S3 Tables MV support — verify `CREATE MATERIALIZED VIEW` works against the s3tablescatalog federation, vs. authoring refresh as a Step Functions/scheduled query that produces a regular Iceberg table. Either is fine; Berg only sees Glue tables either way.
- Predicate-compatibility check: simple "all WHERE columns are in MV `GROUP BY`" v1, vs. richer constant-folding later.
- Refresh staleness — surface `lastRefreshed` in the UI when reading via an MV.

### 2. App E2E setup off ClickHouse

`packages/app/tests/e2e/seed-clickhouse.ts` and the E2E `docker-compose.yml` still spin up a ClickHouse container and seed it with otel-shaped data. After the Phase 1.x port nothing in the app actually queries CH at runtime, so the E2E tests are either passing for the wrong reasons or skipped. Decide: rewrite the seed to populate Athena-compatible Iceberg fixtures via a LocalStack/MinIO + Trino sidecar (heavy), or replace E2E with mock-Athena fixtures and Playwright tests against the API mocks (lighter).

**Value:** unblock E2E CI as a real signal again.

### 3. Dead `BERG_IMAGE` flavor flags

`packages/api/src/config.ts` exports `IS_APP_IMAGE` / `IS_ALL_IN_ONE_IMAGE` / `IS_LOCAL_IMAGE` derived from `BERG_IMAGE` against HyperDX-era flavor strings (`'hyperdx'`, `'all-in-one-auth'`, `'all-in-one-noauth'`). Zero consumers, zero meaning post-Berg. Trivial deletion alongside Phase 2 work.

### 4. `packages/api/bin/hyperdx` rename + tracing review

Entrypoint script is still named `hyperdx` and loads `@hyperdx/node-opentelemetry` tracing at boot. Rename to `berg`; decide whether to keep, swap, or remove the OTel auto-instrumentation depending on Phase 2's observability story.

### 5. Writes / roles / alerts

Long-noted Phase 2 territory in the Phase 1.2 doc. No design yet. Surface these as separate spec docs when the time comes.

---

## How to graduate an item

1. Pick the item.
2. Brainstorm a design (the brainstorming skill); save as `docs/superpowers/specs/YYYY-MM-DD-berg-<item>-design.md`.
3. Write the implementation plan (the writing-plans skill); save under `docs/superpowers/plans/`.
4. Either remove the item from this backlog, or leave a back-pointer to the design doc.
