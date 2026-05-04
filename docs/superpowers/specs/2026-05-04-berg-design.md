# Berg — Design Spec

**Status:** Brainstormed and approved 2026-05-04. Ready for implementation planning.

**One-line summary:** Repurpose HyperDX into **Berg**, a Kibana-style web UI for AWS S3 Tables, using Athena as the query engine.

---

## 1. Goals and non-goals

### Goals (v1)

- Connect to S3 Tables via AWS Athena, browse the Glue Data Catalog, query tables, and visualize results.
- Generalize HyperDX's Lucene search UI to work against any S3 Table — with optional time-bucketing.
- Keep HyperDX's chart and dashboard UX, retargeted at Athena.
- Multi-tenant deployment in EKS, using IRSA-attached IAM identity for AWS access. No AWS credentials stored in the application.

### Non-goals (v1)

- Write operations against S3 Tables (`INSERT` / `UPDATE` / `DELETE` / DDL). Read-only in v1; full read+write planned for Phase 2.
- Roles or fine-grained per-table/per-namespace permissions. Team isolation only in v1.
- Alerts, scheduled queries, OTel ingestion, OpenTelemetry collector.
- Engines other than Athena (no Trino-on-EMR, no DuckDB).
- BYO-AWS / per-team AWS credentials. The pod's IRSA identity is the single AWS principal.

---

## 2. Scope summary

| Decision | Choice |
|---|---|
| Engine | AWS Athena (Trino-flavored SQL) |
| Data | S3 Tables (Apache Iceberg via Glue Data Catalog) |
| Search syntax | Lucene UX preserved; parser ported to emit Trino SQL |
| Time-bucketing | Optional per-Source (`timestampColumn` may be unset) |
| Visualization | Charts + dashboards generalized for any table |
| Multi-tenancy | Kept (HyperDX team-isolation pattern) |
| AWS auth | IRSA pod identity; no creds in application storage |
| HyperDX permissions | v1: team isolation only. Phase 2: roles. |
| Branding | **Berg** (`@berg/api`, `@berg/app`, `@berg/common-utils`) |
| Connection model | **Deleted.** Athena config from env at deploy time. |
| Source model | Single `Table` kind: `{ team, catalog, database, table, displayName, timestampColumn?, defaultSort?, defaultColumns? }` |

---

## 3. System architecture

### Packages

| Package | Status |
|---|---|
| `@berg/api` (← `@hyperdx/api`) | Renamed; ClickHouse paths replaced with Athena |
| `@berg/app` (← `@hyperdx/app`) | Renamed; observability UI stripped |
| `@berg/common-utils` (← `@hyperdx/common-utils`) | Renamed; `clickhouse/` replaced with `athena/`, parser ports to Trino emitter |
| `packages/otel-collector` | **Deleted entirely** |
| `packages/cli` | **Deleted entirely** |

### Deployment

- Single Berg pod runs in EKS with an IRSA-attached IAM role.
- Pod role permissions: `athena:*`, `glue:Get*`, `s3tables:*`, `s3:GetObject/PutObject` (for Athena's result staging).
- MongoDB runs as a StatefulSet alongside (or as managed DocumentDB / Atlas).
- **Zero AWS credentials** in Berg's runtime memory, environment, configuration, or storage. All AWS SDK calls use the pod's ambient identity.

### Trust boundary (security invariant)

Berg's HTTP API is the only path between users and S3 Tables. There is no SQL pass-through endpoint. Every query route runs through:
1. Authentication middleware (`isUserAuthenticated`).
2. Team-isolation gate (existing `getNonNullUserWithTeam` pattern).
3. Lucene-parse-and-emit OR SQL classification (read vs. write).
4. v1: read-only enforcement — write classification returns 403.

This invariant is permanent; Phase 2's read+write must respect it.

### Request flow (search query)

```
Browser
  → Next.js UI
  → POST /api/v1/query  (Express)
      → auth middleware
      → team-isolation gate
      → Lucene parse → AST → Trino SQL emit       (common-utils)
      → SQL classification (v1: reject writes)
      → AthenaClient.startQueryExecution
            workgroup, output bucket from env
            ResultReuseConfiguration { Enabled: true, ExpirationInMinutes: 60 }
      → poll GetQueryExecution every ~1s, exponential backoff, capped at ATHENA_SYNC_TIMEOUT_MS
      → if finished:  GetQueryResults (paged via NextToken)
        else return:  { executionId, status: "running" }
  → JSON { rows, schema, scannedBytes, executionId, status }
  → UI renders results table or chart
```

### Environment variables

| Variable | Required | Purpose |
|---|:-:|---|
| `MONGO_URI` | yes | MongoDB connection string (existing) |
| `ATHENA_REGION` | yes | AWS region for Athena |
| `ATHENA_WORKGROUP` | yes | Athena workgroup name |
| `ATHENA_OUTPUT_LOCATION` | yes | S3 path Athena writes results to (e.g., `s3://my-bucket/athena-results/`) |
| `ATHENA_SYNC_TIMEOUT_MS` | no (default 30000) | Max time the API blocks before returning an `executionId` for client-side polling |
| `ATHENA_RESULT_REUSE_TTL_MIN` | no (default 60) | Athena result-reuse cache TTL in minutes |

---

## 4. Data layer

### 4.1 Athena query client (`@berg/common-utils/athena`)

Replaces `common-utils/clickhouse`. Built on `@aws-sdk/client-athena`. Uses pod's IRSA identity implicitly.

| Method | Purpose |
|---|---|
| `executeSync(sql, options)` | Start query, internally poll up to `ATHENA_SYNC_TIMEOUT_MS`, return rows. Spinner UX. |
| `executeAsync(sql, options)` | Start query, return `{ executionId }` immediately. |
| `getStatus(executionId)` | Poll status (`QUEUED` / `RUNNING` / `SUCCEEDED` / `FAILED` / `CANCELLED`). |
| `getResults(executionId, nextToken?)` | Paged result fetch; max 1000 rows per page. |
| `cancel(executionId)` | `StopQueryExecution`. |

Result shape: `{ rows: object[], schema: ColumnMeta[], scannedBytes: number, executionId: string, status: 'finished' | 'running' | 'failed' }`.

Every query passes `ResultReuseConfiguration { Enabled: true, ExpirationInMinutes: cfg.resultReuseTtlMin }`.

Retry policy: only on transient errors (`ThrottlingException`, `InternalServerException`); never on user-error responses (syntax, permission, column-not-found).

### 4.2 Lucene → Trino parser

`packages/common-utils/src/queryParser.ts` already separates Lucene-grammar parsing from SQL emission via an abstract `SQLSerializer` class (line 387) with a single concrete subclass `CustomSchemaSQLSerializerV2` (line 806) that emits ClickHouse SQL.

- **Keep** the `parse()` function (Lucene → AST) and the abstract `SQLSerializer` class intact.
- **Add** a `TrinoSchemaSerializer` subclass to emit Trino SQL; replace `CustomSchemaSQLSerializerV2` usage with it.
- The Trino emitter handles:
  - Function mapping: `position()` → `strpos()`, JSON path operators → `json_extract_scalar` / `json_extract`, etc.
  - Time bucketing: `date_trunc('minute', ts)` (not ClickHouse's `toStartOfInterval`).
  - Interval syntax: `INTERVAL '5' MINUTE`.
  - Regex: `regexp_like(col, pattern)`.
  - Array/Map access: `[]` syntax; `element_at(map, key)` for missing-key safety.
  - Time arithmetic: `now() - INTERVAL '5' MINUTE`.
- **Delete** `CustomSchemaSQLSerializerV2` and ClickHouse-only helpers (`toUnixTimestamp64Milli`, `toStartOfInterval`, `parseDateTimeBestEffort`, etc.) once nothing references them.
- **Test parity:** every existing parser test gets a Trino-emitter assertion replacing the ClickHouse one (since ClickHouse output is no longer needed in Berg).

When a Source's `timestampColumn` is unset, the parser bypasses the time-window WHERE clause; otherwise it emits `WHERE ts BETWEEN ... AND ...`.

### 4.3 Catalog discovery (`@aws-sdk/client-glue`)

Glue Data Catalog is the source of truth for S3 Tables metadata.

| Operation | Purpose |
|---|---|
| `GetDatabases(catalogId)` | Paged list of namespaces in a catalog |
| `GetTables(catalogId, databaseName)` | Paged list of tables in a database |
| `GetTable(catalogId, databaseName, tableName)` | Schema, partition keys, Iceberg metadata |

Catalog list is filtered to Iceberg/S3-Tables-typed catalogs (skip federated, hive-only legacy). Visibility is implicit: the pod's IAM role determines what's visible; `AccessDenied` results in silent filtering in browse views.

### 4.4 Type mapping (Trino → JS)

A single `convertTrinoTypeToJsType` helper replaces `convertCHDataTypeToJSType`:

| Trino type | JS type |
|---|---|
| `VARCHAR`, `CHAR` | `string` |
| `TINYINT`, `SMALLINT`, `INTEGER`, `BIGINT` | `number` (or `bigint` if precision matters) |
| `REAL`, `DOUBLE`, `DECIMAL` | `number` |
| `BOOLEAN` | `boolean` |
| `DATE`, `TIME`, `TIMESTAMP`, `TIMESTAMP WITH TIME ZONE` | ISO string or `Date` |
| `ARRAY<T>` | `T[]` (recursively unwrapped) |
| `MAP<K, V>` | `Record<string, V>` |
| `ROW(field1 T1, field2 T2, ...)` | `{ field1: T1, field2: T2, ... }` |
| `JSON` | `unknown` |

### 4.5 Query lifecycle

- Sync timeout via `ATHENA_SYNC_TIMEOUT_MS` (default 30000). Beyond it, API returns `{ executionId, status: "running" }`; client polls `GET /api/v1/query/:executionId/results`.
- Cancel via `DELETE /api/v1/query/:executionId` → `StopQueryExecution`. Cancellation is best-effort; Athena charges for any scanning before cancel.
- Cost surfaced in every response as `scannedBytes`. UI renders "Athena · scanned X MB · cached" at the bottom of result views.

---

## 5. Data model

### Connection — DELETED

The Connection model and its routes (`routers/api/connections.ts`, `controllers/connection.ts`) are removed. Athena configuration moves to env. There is no per-team or per-user Connection record.

### Source — collapsed to single `Table` kind

Replaces the four-kind discriminator (Log/Trace/Session/Metric) with a single `Table` kind:

```ts
{
  team: ObjectId,                    // existing team-isolation
  catalog: string,                   // Glue catalog ID (e.g., s3tablescatalog/my-bucket)
  database: string,                  // Glue database name (S3 Tables namespace)
  table: string,                     // Table name within the database
  displayName: string,               // user-facing label
  timestampColumn?: string,          // optional; enables time-bucketed UX
  defaultSort?: string,              // e.g., "event_time DESC"
  defaultColumns?: string[],         // columns shown by default in Search results
  lastQueriedAt?: Date,              // tracked when the Source is opened in Search
}
```

### User — `role` field added (Phase 2 hook)

```ts
{
  // existing fields preserved
  role: 'admin' | 'editor' | 'viewer'  // default 'admin' — preserves v1 behavior
}
```

In v1 every user is `'admin'` and roles are not enforced. In Phase 2, write routes will require `['admin', 'editor']`.

### Models kept unchanged (drop observability fields only)

`Team`, `TeamInvite`, `SavedSearch`, `Dashboard`, `Favorite`, `PinnedFilter`, `PresetDashboardFilter`.

### Models deleted

`Alert`, `AlertHistory`, `Webhook`, `Connection`.

---

## 6. UI surfaces

### Navigation (sidebar, top to bottom)

| Item | Path | Status |
|---|---|---|
| Catalog | `/catalog` | **NEW** |
| Search | `/search` | Generalized for any Table source |
| Saved Searches | `/search/list` | Kept; favorites collapsible |
| Sources | `/sources/list` | **NEW** (was implicit per-Connection list) |
| Chart Explorer | `/chart` | Kept |
| Dashboards | `/dashboards/list` | Kept; favorites collapsible |
| Help | — | Kept |
| Feedback | — | Kept |
| Team Settings | `/team` | Kept |

Removed from nav: Alerts, Client Sessions, Service Map, Onboarding Checklist, Cloud Banner, Careers/Landing footer link.

### Page: Catalog (`/catalog`)

Two-pane layout:
- **Left tree**: Catalog → Database → Table, expandable, top-of-pane filter input.
- **Right detail pane**: breadcrumb, format/partition info, three primary actions (**Save as Source** / **Open in Search** / **Open in SQL**), four tabs (**Schema** / **Sample** / **DDL** / **Stats**).
- Schema tab calls out the auto-detected recommended timestamp column.
- Sample tab runs `SELECT * FROM ... LIMIT 50` via Athena.

### Page: Search / Discover (`/search`)

Two modes, switched on Source's `timestampColumn`:

**Time-enabled mode** (Source has `timestampColumn`):
- Source dropdown (with ⏱ marker) | Lucene search bar | time picker | Run | 💾 save
- Faceted filter sidebar on left
- Histogram above results
- Row table with sticky header; click row → generic JSON side panel
- Cost line at bottom

**No-time mode** (Source has no `timestampColumn`):
- Same chrome; time picker replaced with "no time field" label
- Histogram replaced with a stats line ("X rows match · Y MB scanned · sorted by Z")
- Default sort = Source's `defaultSort` or first column

### Page: Sources list (`/sources/list`)

Table of saved Sources with columns: Name (with ⏱ marker if time column set), Table reference, Time column, Default sort, Last queried, Actions (🔍 search / ⌨ SQL / ✏️ edit / 🗑️ delete). "+ Save a table from Catalog" button at top, plus filter input.

### Modal: Edit Source

Reused for both "Save as Source" (from Catalog) and "Edit" (from Sources list). Fields:
- Display name (required)
- Table reference (read-only, derived from Catalog)
- Time column (dropdown with TIMESTAMP/DATE columns + "— None — flat table mode")
- Default sort
- Default visible columns

### Page: Dashboards (`/dashboards/list`, `/dashboards/[id]`)

UX preserved wholesale. Under the hood:
- Chart config's source picker lists Berg Sources (no telemetry kinds).
- Chart config's SQL emitter goes through the new Lucene → Trino path.
- Charts requiring a time field hide that chart-type option for Sources without `timestampColumn`.
- Tile-level alerts UI removed.

### Removed pages

`SessionsPage`, `DOMPlayer`, `Playbar`, `ServicesDashboardPage`, `KubernetesDashboardPage`, `BenchmarkPage`, `CareersPage`, `LandingPage`, `AlertsPage`, `OnboardingChecklist`, OTel-shaped log/trace side panels (`LogSidePanelElements`, `DBTracePanel`, `DBSessionPanel`).

`JoinTeamPage`, `LoginPage`, `AuthPage`, `RegisterPage` are kept — team invites stay in scope.

### Replaced side panel

`DBRowSidePanel` becomes a generic JSON row inspector. It handles `ARRAY` / `MAP` / `ROW` / `JSON` types recursively. The OTel-shaped log/trace details are deleted.

---

## 7. Permissions

### v1 — team isolation only

- No roles, no per-resource ACLs.
- All team members can read every Source the team has saved and query any namespace the pod's IAM role can reach.
- API trust boundary as described in §3.

### Phase 2 hooks present in v1 schema

- `User.role` populated as `'admin'` for everyone; will gate write routes via `requireRole(['admin', 'editor'])`.
- Source-level permissions field (placeholder, unused) for Phase 2's per-namespace ACL.
- Query classification (read vs. write) computed at parse time on every emitted SQL; v1 returns 403 on write classification (defense-in-depth even though no UI surfaces write).

### Phase 2 (deferred to a later spec)

- Roles enforced (admin / editor / viewer).
- Read+write support: `INSERT`, `UPDATE`, `DELETE`, schema DDL.
- Confirmation flow before destructive operations.
- Per-namespace ACL grants on top of role.

---

## 8. Testing strategy

### Unit (`make ci-unit`)

- **Lucene → Trino parser** — every existing assertion gets a Trino-emitter parallel.
- **Athena client** — mock `@aws-sdk/client-athena`; cover sync polling, async start, status, pagination, cancel, error mapping.
- **Glue catalog client** — mock `@aws-sdk/client-glue`; database list, table list, schema fetch, AccessDenied filtering.
- **Type mapping** — Trino primitive coverage plus ARRAY/MAP/ROW/JSON.
- **API routes** — auth, team isolation, query gate, write-classification rejection.

### Integration (`make dev-int`)

- MongoDB + LocalStack (provides Athena + Glue mocks).
- Save Source → run query → cancel → fetch results → schema fetch.

### E2E (Playwright, `make dev-e2e`)

~5 critical specs:
1. Catalog browse → save Source.
2. Search with Lucene against a time-enabled Source.
3. Search with Lucene against a no-time Source.
4. Save and reload a SavedSearch.
5. Open a Dashboard with mixed time-enabled and no-time charts.

---

## 9. Migration sequence and PR plan

Eleven implementation tasks, suggested PR grouping:

| # | Task | PR |
|--:|---|---|
| 1 | Rebrand packages from `@hyperdx/*` to `@berg/*` | PR1 |
| 2 | Strip observability-specific UI and code | PR1 |
| 3 | Delete Connection model; Athena config from env | PR1 |
| 4 | Implement Athena query client | PR2 |
| 5 | Port Lucene parser to emit Trino SQL | PR2 |
| 6 | Implement Glue catalog discovery | PR2 |
| 7 | Implement query lifecycle API endpoints | PR2 |
| 8 | Build Catalog page | PR3 |
| 9 | Generalize Search/Discover for time-optional Sources | PR3 |
| 10 | Build Sources list and Edit Source modal | PR3 |
| 11 | Generalize Dashboard charts for any table | PR4 |

PR1 strips the codebase to a clean Berg-shell. PR2 adds the Athena data layer end-to-end. PR3 lights up the user-facing pages. PR4 finishes the visualization surface.

---

## 10. Risks and edge cases

### Athena edge cases

- **Scan limits exceeded** — friendly error with link to workgroup config.
- **AccessDenied** from Glue — silent filtering in catalog browse; explicit error only on direct fetch.
- **Cancelled queries** — still billed for any pre-cancel scanning; UI surfaces this honestly.
- **Schema drift** — table dropped between schema fetch and query → friendly "table not found" error.
- **Query timeout** — sync API returns `executionId`; client continues polling. No accidental client disconnections lose the query.

### Schema discovery

- Tables with zero columns render an empty-state schema view.
- `MAP<VARCHAR, VARCHAR>` columns renderable in row inspector (recursive expand).
- `STRUCT/ROW` types recursively expanded in side panel.

### Lucene against unknown columns

Parser validates against fetched schema before sending to Athena; returns "column 'foo' not found in events" rather than opaque Athena syntax error.

### Cost protection

Workgroup-level scan limit (Athena's native feature) is the deployment-side ceiling. Per-Source scan-estimate guards are deferred to a later phase.

### Single-pod / scaling

For PoC, Berg runs as a single pod with MongoDB StatefulSet. Multiple replicas are not blocked by anything in this design (sessions are MongoDB-stored, query state is server-stateless once `executionId` is returned), but no horizontal scaling work is in scope for v1.

---

## 11. Open items deferred to Phase 2

- Write support — `INSERT` / `UPDATE` / `DELETE` / DDL.
- Roles (admin / editor / viewer) and per-namespace ACLs.
- Alerts (model deleted; will be reintroduced as a fresh design).
- Scheduled queries.
- Cost guards beyond workgroup-level scan limits.
- Cross-engine support (Trino-on-EMR, DuckDB).
- Migration to DynamoDB metadata store (PoC stays on MongoDB).
