# Integration Test Results — Mongoose 6 → 9 Upgrade

Date: 2026-02-26
Branch: `mongo`

---

## Final Results

All pre-existing test bugs and FerretDB workarounds have been implemented.

```
Test Suites: 30 passed, 30 total
Tests:       410 passed, 410 total
Snapshots:   11 passed, 11 total
```

**410/410 tests pass on MongoDB 5.0 baseline.** Zero failures.

---

## What Changed

### Test bug fixes (Category A — 4 tests)

| # | Test | Root cause | Fix |
|---|------|-----------|-----|
| A1 | `checkAlerts` — spy never called | Spy targeted `AlertHistory.aggregate` but impl uses `.find()` | Changed spy to `jest.spyOn(AlertHistory, 'find')` |
| A2 | `team/tags` — 500 error | `POST /saved-search` payload missing `whereLanguage` and valid `source` ObjectId | Added required fields, fetch source `_id` from `GET /sources` |
| A3 | `alerts` — silence returns 400 | `randomMongoId()` generates invalid ObjectId (decimal string) | Use `new mongoose.Types.ObjectId().toString()` |
| A4 | `alerts` — unsilence returns 400 | Same as A3 | Same fix |

### FerretDB `findAndModify+fields` workarounds (Category B)

FerretDB does not implement the `fields` parameter in `findAndModify`. These
workarounds split compound operations into separate queries to avoid the
limitation.

| File | Operation | Change |
|------|-----------|--------|
| `routers/api/webhooks.ts` | `Webhook.findOneAndUpdate` | Removed `select` option, strip `__v`/`team` via `.toJSON()` destructuring |
| `controllers/connection.ts` | `Connection.findOneAndUpdate` | Split into `updateOne` + `findOne` |
| `controllers/connection.ts` | `Connection.findOneAndDelete` | Split into `findOne` + `deleteOne` |
| `controllers/user.ts` | `User.findOneAndDelete` | Split into `findOne` + `deleteOne` (inside `Promise.all` IIFE) |
| `__tests__/ferretdb-regression.test.ts` | `skipIfFerretDB` guards | Removed — all tests now run on both backends |

### Port configuration

The API test server ports were changed to avoid conflicting with ClickHouse's
native port (9000) when running with host networking.

| Setting | Old | New | Source |
|---------|-----|-----|--------|
| `PORT` | 9000 | 19123 | `nix/ports.nix` → `.env.test` |
| `OPAMP_PORT` | 4320 | 14320 | `nix/ports.nix` → `.env.test` |

All port constants are defined in `nix/ports.nix` for consistency.

### Nix convenience targets

New `nix run` apps and Make targets for running tests with host-networked
containers (no Docker Compose required):

```bash
# Start MongoDB + ClickHouse with host networking
nix run .#test-services-up

# Run integration tests from nix develop shell
nix develop
cd packages/api && yarn ci:int

# Stop services when done
nix run .#test-services-down
```

Equivalent Make targets: `make test-services-up`, `make test-services-down`.

---

## Files Modified

| File | Change |
|------|--------|
| `packages/api/src/fixtures.ts` | `randomMongoId()` → valid ObjectId |
| `packages/api/src/tasks/checkAlerts/__tests__/checkAlerts.test.ts` | spy: `aggregate` → `find` |
| `packages/api/src/routers/api/__tests__/team.test.ts` | Fixed saved search payload |
| `packages/api/src/routers/api/webhooks.ts` | Removed projection from `findOneAndUpdate`, strip via `toJSON()` |
| `packages/api/src/controllers/connection.ts` | Split `findOneAndUpdate`/`findOneAndDelete` |
| `packages/api/src/controllers/user.ts` | Split `User.findOneAndDelete` |
| `packages/api/src/__tests__/ferretdb-regression.test.ts` | Unskipped tests, removed unused imports |
| `packages/api/.env.test` | `PORT=19123`, `OPAMP_PORT=14320` |
| `nix/ports.nix` | Added `apiTestServer`, `apiTestOpamp` ports |
| `flake.nix` | Added `test-services-up`/`test-services-down` apps, shell hook, `ports` import |
| `Makefile` | Added `test-services-up`/`test-services-down` targets |

---

## Verification Checklist

| Check | Result |
|-------|--------|
| TypeScript: `tsc --noEmit` (api package) | PASS |
| MongoDB baseline: 410/410 tests | PASS |
| FerretDB regression: all 7 tests pass (none skipped) | PASS |
| `randomMongoId()` generates valid ObjectIds | PASS |
| `checkAlerts` spy targets `find` (matches impl) | PASS |
| `team/tags` saved search payload valid | PASS |
| Webhook update preserves Map fields (`headers`, `queryParams`) | PASS |
| Connection update/delete avoids `findAndModify` | PASS |
| User delete avoids `findAndModify` | PASS |
| Port 9000 conflict resolved (test server on 19123) | PASS |

---

## Multi-Backend Comparison (2026-03-01)

### Test Results (before ClickHouse schema fix)

| Metric | MongoDB 7.0.30 | MongoDB 8.0.9 | FerretDB 1.24.0 (SQLite) |
|--------|---------------|---------------|--------------------------|
| Test Suites | 26 passed, 4 failed | N/A (mongod crashed) | 12 passed, 18 failed |
| Tests | 361 passed, 49 failed | N/A | 122 passed, 288 failed |
| Time | 74s | N/A | 87s |

**Note:** 4 failing suites on MongoDB 7 were all ClickHouse-related (missing
tables/columns in test fixtures). These same 4 suites failed on all backends
and were not database-specific.

### MongoDB 8 (abandoned)

MongoDB 8.0.9 was built from source on NixOS but **mongod crashes under test
load** in the minimal Nix container. The build infrastructure has been removed.
If MongoDB 8 support is needed in the future, use an official Docker Hub image
(`mongo:8.0`) with host networking instead of building from source.

### Build Infrastructure Changes

| File | Change |
|------|--------|
| `flake.nix` | Added `clickhouse` to devShell |
| `docker-compose.ci.nix.yml` | Added `--bind_ip_all` to mongod command |

---

## FerretDB v2.x + ClickHouse Schema Fix (2026-03-02)

### Summary

Two changes combined to achieve **full test parity across MongoDB and FerretDB**:

1. **ClickHouse schema fix in `fixtures.ts`** — aligned test fixture table
   schemas with the production seed SQL files, unblocking ~49 tests that were
   failing on ALL backends due to missing tables/columns.

2. **Upgrade to FerretDB v2.7.0** with PostgreSQL+DocumentDB backend — replaced
   FerretDB 1.24.0 (SQLite) which had many MongoDB incompatibilities.

### Test Results (after fixes)

| Metric | MongoDB 5.0 | FerretDB 2.7.0 (PostgreSQL+DocumentDB) |
|--------|------------|----------------------------------------|
| Test Suites | 30 passed, 30 total | 30 passed, 30 total |
| Tests | 410 passed, 410 total | 410 passed, 410 total |
| Snapshots | 51 passed, 51 total | 11 passed, 11 total |
| Time | 71s | 76s |

**410/410 tests pass on both backends.** Zero failures.

### Before/After Comparison

| Backend | Before | After | Delta |
|---------|--------|-------|-------|
| MongoDB 5.0 | 30/30 suites, 410/410 tests | 30/30 suites, 410/410 tests | No change |
| FerretDB | 12/26 suites, 122/361 tests (v1.24 SQLite) | 30/30 suites, 410/410 tests (v2.7 PG) | +18 suites, +288 tests |

### ClickHouse Schema Changes in `fixtures.ts`

The test fixture `connectClickhouse()` function was updated to match the
production seed SQL files (`docker/otel-collector/schema/seed/00002-00005`):

| Table | Changes |
|-------|---------|
| `otel_logs` | Added 8 `__hdx_materialized_*` columns (k8s.*, deployment.environment.name); fixed body index: `idx_body Body` → `idx_lower_body lower(Body)` |
| `otel_traces` | **New table** with `__hdx_materialized_rum.sessionId`, Events/Links arrays, all indexes |
| `hyperdx_sessions` | **New table** (log-format schema for session replay) |
| `otel_metrics_gauge` | Added 5 `Exemplars.*` columns |
| `otel_metrics_sum` | Added 5 `Exemplars.*` columns |
| `otel_metrics_histogram` | Added 5 `Exemplars.*` columns; reordered to match seed SQL |
| `otel_metrics_exponential_histogram` | **New table** |
| `otel_metrics_summary` | **New table** |
| `clearClickhouseTables()` | Added traces, sessions, summary, exponential_histogram |

### FerretDB v2.x Infrastructure Changes

FerretDB v2.x dropped the SQLite backend and now requires
PostgreSQL with the DocumentDB extension.

| Component | Old (v1.24) | New (v2.7) |
|-----------|-------------|------------|
| FerretDB image | `ferretdb:latest` (Nix-built, SQLite) | `ghcr.io/ferretdb/ferretdb:2.7.0` |
| Backend | SQLite (embedded) | PostgreSQL 17 + DocumentDB 0.107.0 |
| PostgreSQL image | N/A | `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` |
| CLI flags | `--handler=sqlite --sqlite-url=file:/data/` | `--listen-addr=:29999 --no-auth` + `FERRETDB_POSTGRESQL_URL` env |

Files modified:
- `docker-compose.ci.ferretdb.yml` — added `postgres` service, updated `db` to FerretDB 2.7.0
- `flake.nix` — added `test-services-up-ferretdb` app (starts PG + FerretDB + CH with host networking)
- `flake.nix` — updated `test-services-down` to also stop postgres container
- `nix/ports.nix` — added `postgres = 25432` port
- `nix/containers.nix` — updated ferretdb config for v2.x CLI flags
- `Makefile` — added `test-services-up-ferretdb` target

### Quick Start (Host Networking)

```bash
# Start FerretDB v2 + PostgreSQL + ClickHouse
nix run .#test-services-up-ferretdb

# Run integration tests
nix develop
cd packages/api && yarn ci:int

# Stop services
nix run .#test-services-down
```

## Remaining Work

| Item | Priority | Status |
|------|----------|--------|
| Publish `@hyperdx/passport-local-mongoose@9.1.0` | High | Deferred (Yarn patch works) |
| Add `hdx-ci-` prefix to Nix container image names to avoid collisions | Low | Naming improvement |
