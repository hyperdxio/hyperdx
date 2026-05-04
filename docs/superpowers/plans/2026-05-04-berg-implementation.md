# Berg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers-extended-cc:subagent-driven-development` (recommended) or `superpowers-extended-cc:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repurpose HyperDX into **Berg** — a Kibana-style web UI for AWS S3 Tables backed by Athena, in 11 sequenced tasks across 4 PRs.

**Architecture:** Approach A from the design spec — single dialect (Trino), synchronous-with-async-fallback query lifecycle, minimal abstraction. ClickHouse code paths replaced wholesale. Single generic `Table` source kind. Pod-level IRSA for AWS auth — zero credentials in application storage. HyperDX permissions stay flat (team isolation only) for v1; `User.role` and write-classification are present as Phase 2 hooks.

**Spec:** [`docs/superpowers/specs/2026-05-04-berg-design.md`](../specs/2026-05-04-berg-design.md)

**Tech Stack:** Next.js 14, Express, Mongoose + MongoDB, AWS Athena + Glue (`@aws-sdk/client-athena`, `@aws-sdk/client-glue`), Mantine UI, TanStack Query, Jest, Playwright.

---

## File Structure

Three packages survive (renamed); two are deleted entirely.

### `@berg/common-utils` (was `@hyperdx/common-utils`)
- `src/athena/index.ts` — **NEW** Athena client (replaces `clickhouse/`)
- `src/athena/types.ts` — **NEW** types for query results, status, errors
- `src/glue/index.ts` — **NEW** Glue catalog client
- `src/queryParser.ts` — **MODIFY** add `TrinoSchemaSerializer` subclass; remove `CustomSchemaSQLSerializerV2` once unreferenced
- `src/types.ts` — **MODIFY** drop `LogSourceSchema`, `TraceSourceSchema`, `SessionSourceSchema`, `MetricSourceSchema`; add `TableSourceSchema`
- `src/clickhouse/` — **DELETE** entire directory
- `src/__tests__/queryParser.test.ts` — **MODIFY** assertions emit Trino instead of ClickHouse
- `src/__tests__/athena.test.ts` — **NEW** Athena client tests
- `src/__tests__/glue.test.ts` — **NEW** Glue client tests

### `@berg/api` (was `@hyperdx/api`)
- `src/config.ts` — **MODIFY** drop ClickHouse/OpAMP env vars; add Athena env vars
- `src/models/source.ts` — **MODIFY** collapse 4-kind discriminator to single `Table` kind
- `src/models/connection.ts` — **DELETE**
- `src/models/alert.ts`, `alertHistory.ts`, `webhook.ts` — **DELETE**
- `src/models/user.ts` — **MODIFY** add `role: 'admin' | 'editor' | 'viewer'` field, default `'admin'`
- `src/routers/api/index.ts` — **MODIFY** unregister deleted routers; register `query`, `catalog`
- `src/routers/api/connections.ts`, `alerts.ts`, `webhooks.ts`, `clickhouseProxy.ts` — **DELETE**
- `src/routers/api/query.ts` — **NEW** query lifecycle endpoints
- `src/routers/api/catalog.ts` — **NEW** Glue catalog discovery endpoints
- `src/controllers/connection.ts`, `alerts.ts`, `alertHistory.ts` — **DELETE**
- `src/controllers/query.ts`, `catalog.ts` — **NEW**
- `src/clickhouse/` — **DELETE**

### `@berg/app` (was `@hyperdx/app`)
- `pages/catalog/index.tsx` — **NEW** Catalog landing
- `pages/catalog/[catalog]/[database]/[table].tsx` — **NEW** Catalog table detail
- `pages/sources/list.tsx` — **NEW** Sources list page
- `pages/_app.tsx`, `_document.tsx`, `index.tsx` — **MODIFY** branding
- `pages/sessions.tsx`, `services.tsx`, `service-map.tsx`, `kubernetes.tsx`, `alerts.tsx`, `benchmark.tsx`, `careers.tsx` — **DELETE**
- `src/components/AppNav/AppNav.tsx` — **MODIFY** remove observability nav links; add Catalog and Sources
- `src/components/CatalogTree.tsx`, `CatalogTableDetail.tsx` — **NEW**
- `src/components/SourcesList.tsx`, `EditSourceModal.tsx` — **NEW**
- `src/components/DBRowSidePanel.tsx` — **MODIFY** generic JSON inspector (replaces OTel-shaped panel)
- `src/DBSearchPage.tsx` — **MODIFY** drop source-kind branching, time-optional UI
- `src/DBDashboardPage.tsx`, `DBChartPage.tsx`, `components/ChartEditor/*` — **MODIFY** generalize for Table source
- `src/SessionsPage.tsx`, `ServicesDashboardPage.tsx`, `KubernetesDashboardPage.tsx`, `AlertsPage.tsx`, etc. — **DELETE**
- `src/components/LogSidePanelElements.tsx`, `DBTracePanel.tsx`, `DBSessionPanel.tsx`, etc. — **DELETE**
- `src/api.ts`, `src/source.ts`, `src/connection.ts` — **MODIFY** drop ClickHouse / Connection / 4-kind logic

### Deleted in full
- `packages/otel-collector/`
- `packages/cli/`

---

## Sequencing and PR plan

The 11 tasks group into 4 PRs. **Each PR must compile, lint, and pass unit tests before merging.** Within a PR, tasks can run in parallel where dependencies allow.

| PR | Tasks | Theme |
|---:|---|---|
| **PR1** | 1, 2, 3 | Strip + rebrand. Codebase becomes a Berg-shell with no Athena/Glue yet. |
| **PR2** | 4, 5, 6, 7 | Data layer. Athena client, Trino emitter, Glue browse, query API. |
| **PR3** | 8, 9, 10 | UI surfaces. Catalog page, Search/Discover, Sources list. |
| **PR4** | 11 | Dashboard generalization. |

**Dependencies:**

- Task 1 (rebrand) lands first; all others depend on it.
- Tasks 2 and 3 are independent; can run in parallel within PR1.
- Tasks 4, 5, 6 are independent within PR2; Task 7 depends on 4 + 5.
- Task 8 depends on 6. Task 9 depends on 5 + 7. Task 10 depends on Source model from Task 3.
- Task 11 depends on 5 + 7.

---

## Conventions

- **TDD:** every task starts with at least one failing test before implementation.
- **Commits:** each task ends with a single commit. Pre-commit hooks run lint/format. Never use `--no-verify`.
- **Lint/type:** `make ci-lint` must pass at the end of every task.
- **Branch naming:** `claude/berg-pr1-strip-rebrand`, `claude/berg-pr2-data-layer`, etc.
- **Test imports:** `@/...` path alias is configured in each package; use it.

---

# PR1 — Strip and rebrand

## Task 1: Rebrand packages from `@hyperdx/*` to `@berg/*`

**Goal:** Every package, import, branding string, and configuration that says "hyperdx" now says "berg" (case-preserved). The build still passes.

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/api/package.json`, `packages/app/package.json`, `packages/common-utils/package.json`
- Modify: `packages/api/src/**/*.ts` — imports of `@hyperdx/common-utils` → `@berg/common-utils`
- Modify: `packages/app/src/**/*.tsx`, `packages/app/pages/**/*.tsx` — same import substitutions + UI branding strings
- Modify: `packages/common-utils/tsconfig.json`, `packages/api/tsconfig.json`, `packages/app/tsconfig.json` — path aliases referencing `@hyperdx/*`
- Modify: `README.md`, `AGENTS.md`, `CLAUDE.md` — all "HyperDX" / "hyperdx" mentions where they describe the product (keep historical references in docs about the original repo)
- Modify: `Makefile` — any `hyperdx` references in build targets
- Modify: `docker-compose.dev.yml`, `docker-compose.yml` — service names and image tags
- Modify: `packages/app/src/theme/themes/**` — wordmark / logomark assets if they say "HyperDX"
- Delete: `packages/cli/` (no Berg CLI in v1)

**Acceptance Criteria:**

- [ ] `grep -r "@hyperdx/" packages/*/src packages/*/package.json | grep -v node_modules` returns nothing
- [ ] `grep -r "@hyperdx/" packages/*/pages` returns nothing
- [ ] `package.json` and all sub-package `package.json` use `@berg/...` for `name`
- [ ] App title and nav wordmark say "Berg"
- [ ] `make ci-lint` passes
- [ ] `make ci-unit` passes (existing tests still work, just renamed)

**Verify:** `grep -r "@hyperdx" packages --include="*.ts" --include="*.tsx" --include="*.json" | grep -v node_modules | grep -v hyperdx.io` returns nothing.

**Steps:**

- [ ] **Step 1: Plan the rename in a checklist file**

Run before editing:
```bash
grep -r "@hyperdx/" --include="*.ts" --include="*.tsx" --include="*.json" -l packages 2>/dev/null | grep -v node_modules > /tmp/berg-rename-files.txt
wc -l /tmp/berg-rename-files.txt
```
Expected: ~80–150 file matches.

- [ ] **Step 2: Rename root and sub-package `package.json`**

```bash
sed -i.bak 's/"@hyperdx\//"@berg\//g' package.json packages/*/package.json
```
Verify: `grep "@hyperdx" package.json packages/*/package.json` returns nothing.

- [ ] **Step 3: Rename TypeScript imports across all source files**

```bash
find packages -type f \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" \
  -exec sed -i.bak 's/@hyperdx\/common-utils/@berg\/common-utils/g; s/@hyperdx\/api/@berg\/api/g; s/@hyperdx\/app/@berg\/app/g' {} +
find packages -name "*.bak" -delete
```

- [ ] **Step 4: Rename TypeScript path aliases in tsconfig**

Update each `tsconfig.json` `paths` entry to use the new package names. The pattern is:
```json
{
  "compilerOptions": {
    "paths": {
      "@berg/common-utils/*": ["../../common-utils/dist/*"]
    }
  }
}
```

- [ ] **Step 5: Update branding strings in UI**

In `packages/app/src/components/AppNav/AppNav.tsx`, the wordmark/logomark are loaded from `useWordmark()` / `useLogomark()` (theme system). Update the theme files at `packages/app/src/theme/themes/**` so the wordmark reads "Berg" instead of "HyperDX".

In `packages/app/pages/_document.tsx` and `packages/app/pages/_app.tsx`, replace any hardcoded "HyperDX" page titles with "Berg".

In `packages/app/package.json`, update the `description` field.

- [ ] **Step 6: Delete `packages/cli`**

```bash
git rm -r packages/cli
```
Update root `package.json` `workspaces` to remove `packages/cli`.

- [ ] **Step 7: Update README, AGENTS.md, CLAUDE.md, Makefile, docker-compose**

Replace product-name references ("HyperDX" → "Berg") in:
- `README.md`
- `AGENTS.md` (root and any `agent_docs/` files)
- `CLAUDE.md`
- `Makefile` (build targets that reference the project name)
- `docker-compose.dev.yml`, `docker-compose.yml` (service names like `hyperdx-app` → `berg-app`)

Keep historical references intact in `agent_docs/architecture.md` etc. where they describe origin (e.g., "Berg is a fork of HyperDX..." can stay).

- [ ] **Step 8: Install renamed packages**

```bash
yarn install
```
Verify: `yarn workspaces list` lists `@berg/api`, `@berg/app`, `@berg/common-utils`.

- [ ] **Step 9: Build common-utils and verify build**

```bash
yarn build:common-utils
make ci-lint
make ci-unit
```
All three must succeed. Fix import errors as they surface.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: rebrand @hyperdx/* packages to @berg/*

Rename all package names, imports, tsconfig paths, branding strings,
docker-compose service names, and CLI tool. Delete packages/cli.
No behavior changes."
```

---

## Task 2: Strip observability-specific UI and code

**Goal:** Delete every observability-specific page, component, model, router, controller, and package. The codebase becomes a Berg-shell with auth, dashboards, charts, search UI, and team management — but no Logs/Traces/Sessions/Metrics.

**Files:**

Delete (full list):
- **Pages:** `packages/app/pages/sessions.tsx`, `services.tsx`, `service-map.tsx`, `kubernetes.tsx`, `alerts.tsx`, `benchmark.tsx`, `careers.tsx`
- **Page components:** `packages/app/src/SessionsPage.tsx`, `SessionSidePanel.tsx`, `SessionSubpanel.tsx`, `SessionEventList.tsx`, `ServicesDashboardPage.tsx`, `KubernetesDashboardPage.tsx`, `AlertsPage.tsx`, `BenchmarkPage.tsx`, `CareersPage.tsx`, `LandingPage.tsx`, `LandingHeader.tsx`, `OnboardingChecklist.tsx`, `DBServiceMapPage.tsx`
- **Side panels:** `LogSidePanelElements.tsx`, `LogSidePanelElements.stories.tsx`, `NodeDetailsSidePanel.tsx`, `PodDetailsSidePanel.tsx`, `NamespaceDetailsSidePanel.tsx`, `DBTracePanel.tsx`, `DBSessionPanel.tsx`, `DBTraceWaterfallChart.tsx`, `KubeComponents.tsx`, `DOMPlayer.tsx`, `Playbar.tsx`, `PlaybarSlider.tsx`
- **Auxiliary:** `serviceDashboard.ts`, `sessions.ts`, `dashboardTemplates/`, `hdxMTViews.ts`, `otelSemanticConventions.ts`, `useSourceMappedFrame.tsx`
- **Models (api):** `packages/api/src/models/alert.ts`, `alertHistory.ts`, `webhook.ts`
- **Routers:** `packages/api/src/routers/api/alerts.ts`, `webhooks.ts`, `clickhouseProxy.ts`
- **Controllers:** `packages/api/src/controllers/alerts.ts`, `alertHistory.ts`
- **MCP:** `packages/api/src/mcp/` (entire directory) — observability-shaped MCP tools
- **OpAMP:** `packages/api/src/opamp/` (entire directory)
- **Tasks:** `packages/api/src/tasks/` files that reference removed models — review and delete observability-specific scheduled tasks
- **Package:** `packages/otel-collector/` (entire package directory)

Modify:
- `packages/api/src/routers/api/index.ts` — remove `alertsRouter`, `webhooksRouter` from export
- `packages/api/src/api-app.ts` — remove route registration lines for the deleted routers
- `packages/app/src/components/AppNav/AppNav.tsx` — remove `NAV_LINKS` entries for `alerts`, `sessions`, `service-map`; remove `OnboardingChecklist` import and render
- `packages/app/pages/index.tsx` — replace any landing-page → DBSearchPage redirect with `/catalog`
- `packages/app/src/savedSearch.ts`, `dashboard.ts` — drop `alerts` field from types and render
- `packages/api/src/models/savedSearch.ts`, `dashboard.ts` — drop alert references
- Root `package.json` `workspaces` — remove `packages/otel-collector` entry
- Remove `@clickhouse/client`, `@clickhouse/client-web`, `@hyperdx/node-opentelemetry` (the agent), all OTel collector deps from `package.json` files

**Acceptance Criteria:**

- [ ] No imports of any deleted file remain (`make ci-lint` would catch — but also explicitly: `grep -r "from '@/SessionsPage'" packages/app/src` returns nothing)
- [ ] `make ci-lint` passes
- [ ] `make ci-unit` passes
- [ ] `yarn build:common-utils` succeeds
- [ ] App boots in dev mode and renders the search page (even though Athena isn't wired yet, the existing ClickHouse fallback should still work because we haven't replaced it yet — that's PR2)
- [ ] Nav has no Sessions / Service Map / Alerts / Onboarding / Careers links

**Verify:** `grep -rn "Sessions\|ServiceMap\|Kubernetes\|Alerts" packages/app/src --include="*.tsx" | grep -v node_modules | grep -v "// " | wc -l` returns < 5 (some unrelated string matches OK).

**Steps:**

- [ ] **Step 1: Catalogue files to delete**

```bash
cat > /tmp/berg-delete-list.txt <<'EOF'
packages/app/pages/sessions.tsx
packages/app/pages/services.tsx
packages/app/pages/service-map.tsx
packages/app/pages/kubernetes.tsx
packages/app/pages/alerts.tsx
packages/app/pages/benchmark.tsx
packages/app/pages/careers.tsx
packages/app/src/SessionsPage.tsx
packages/app/src/SessionSidePanel.tsx
packages/app/src/SessionSubpanel.tsx
packages/app/src/SessionEventList.tsx
packages/app/src/ServicesDashboardPage.tsx
packages/app/src/KubernetesDashboardPage.tsx
packages/app/src/AlertsPage.tsx
packages/app/src/BenchmarkPage.tsx
packages/app/src/CareersPage.tsx
packages/app/src/LandingPage.tsx
packages/app/src/LandingHeader.tsx
packages/app/src/OnboardingChecklist.tsx
packages/app/src/DBServiceMapPage.tsx
packages/app/src/DOMPlayer.tsx
packages/app/src/Playbar.tsx
packages/app/src/PlaybarSlider.tsx
packages/app/src/components/LogSidePanelElements.tsx
packages/app/src/components/LogSidePanelElements.stories.tsx
packages/app/src/components/NodeDetailsSidePanel.tsx
packages/app/src/components/PodDetailsSidePanel.tsx
packages/app/src/components/NamespaceDetailsSidePanel.tsx
packages/app/src/components/DBTracePanel.tsx
packages/app/src/components/DBSessionPanel.tsx
packages/app/src/components/DBTraceWaterfallChart.tsx
packages/app/src/components/KubeComponents.tsx
packages/app/src/components/DBInfraPanel.tsx
packages/app/src/serviceDashboard.ts
packages/app/src/sessions.ts
packages/app/src/dashboardTemplates
packages/app/src/hdxMTViews.ts
packages/app/src/otelSemanticConventions.ts
packages/app/src/useSourceMappedFrame.tsx
packages/api/src/models/alert.ts
packages/api/src/models/alertHistory.ts
packages/api/src/models/webhook.ts
packages/api/src/routers/api/alerts.ts
packages/api/src/routers/api/webhooks.ts
packages/api/src/routers/api/clickhouseProxy.ts
packages/api/src/controllers/alerts.ts
packages/api/src/controllers/alertHistory.ts
packages/api/src/mcp
packages/api/src/opamp
packages/otel-collector
EOF
```

- [ ] **Step 2: Verify each file/dir exists, then delete**

```bash
while IFS= read -r path; do
  if [ -e "$path" ]; then
    git rm -rf "$path"
  else
    echo "MISSING (skipped): $path"
  fi
done < /tmp/berg-delete-list.txt
```

- [ ] **Step 3: Update `packages/api/src/routers/api/index.ts`**

Replace contents:
```ts
import aiRouter from './ai';
import dashboardRouter from './dashboards';
import meRouter from './me';
import rootRouter from './root';
import teamRouter from './team';
import savedSearchRouter from './savedSearch';
import sourcesRouter from './sources';
import favoritesRouter from './favorites';
import pinnedFiltersRouter from './pinnedFilters';

export default {
  aiRouter,
  dashboardRouter,
  meRouter,
  rootRouter,
  teamRouter,
  savedSearchRouter,
  sourcesRouter,
  favoritesRouter,
  pinnedFiltersRouter,
};
```

- [ ] **Step 4: Update `packages/api/src/api-app.ts`**

Find the `app.use(...)` calls registering the deleted routers (alerts, webhooks, clickhouseProxy) and delete those lines. Verify by:
```bash
grep -n "alertsRouter\|webhooksRouter\|clickhouseProxyRouter" packages/api/src/api-app.ts
```
Expected: no output.

- [ ] **Step 5: Update `packages/app/src/components/AppNav/AppNav.tsx`**

Replace the `NAV_LINKS` constant (lines 70-97) with a Berg-appropriate list. We'll add Catalog and Sources in Task 8 / Task 10; for now, just remove the deleted ones:
```ts
const NAV_LINKS: NavLinkConfig[] = [
  {
    id: 'chart',
    label: 'Chart Explorer',
    href: '/chart',
    icon: <IconChartDots size={16} />,
  },
];
```

Remove the `OnboardingChecklist` import and the `<OnboardingChecklist ... />` render.

Remove the `<Link href="/careers">` block in the footer.

- [ ] **Step 6: Update `packages/app/pages/index.tsx`**

Find the redirect logic that points unauthenticated/landing visits at `LandingPage` or HyperDX-specific pages. Replace with a redirect to `/catalog` for authenticated users, `/login` for unauthenticated.

- [ ] **Step 7: Drop alert fields from `SavedSearch` and `Dashboard` types**

In `packages/common-utils/src/types.ts`, remove `alerts` field from `SavedSearchSchema` and tile-level alert config from `DashboardSchema`. Re-build common-utils.

In `packages/api/src/models/savedSearch.ts` and `dashboard.ts`, drop the alerts-related schema fields.

In `packages/app/src/savedSearch.ts` and `dashboard.ts`, drop alerts hooks and rendering.

In `packages/app/src/components/AlertStatusIcon.tsx` and `AlertPreviewChart.tsx`, delete (no longer referenced after savedSearch/dashboard updates).

- [ ] **Step 8: Remove ClickHouse and OTel collector dependencies from `package.json`**

In `package.json` (root) `workspaces`, remove `packages/otel-collector`.

In `packages/api/package.json`, `packages/app/package.json`, `packages/common-utils/package.json` — remove these from `dependencies`:
```
"@clickhouse/client"
"@clickhouse/client-web"
"@hyperdx/node-opentelemetry"
```
(NOTE: `@hyperdx/browser` is the user-facing tracker; keep or replace later. Skip in this task.)

We'll add `@aws-sdk/client-athena` and `@aws-sdk/client-glue` in Task 4.

- [ ] **Step 9: Run lint and unit tests, fix any orphan imports**

```bash
yarn install
yarn build:common-utils
make ci-lint 2>&1 | tee /tmp/lint-output.txt
make ci-unit 2>&1 | tee /tmp/unit-output.txt
```

Expect dozens of "Cannot find module" errors initially. Fix each by deleting the orphan import line. Re-run until green.

- [ ] **Step 10: Manual smoke test**

```bash
yarn dev
```

Open http://localhost:30276 (or whatever your slot is). Verify:
- Login page renders
- After login, you land on a search page (existing fallback)
- Nav has only: Search, Saved Searches, Chart Explorer, Dashboards, Help, Feedback, Team Settings
- No console errors about missing observability components

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: strip observability-specific UI, models, routes, and packages

Delete sessions/replay, service map, kubernetes, alerts, OpAMP, MCP,
otel-collector package, and all OTel-shaped side panels. Remove
ClickHouse client deps from package.json. Update AppNav and routers
to drop deleted entries. SavedSearch and Dashboard models drop their
alert fields.

This leaves a Berg-shell with only auth, search (still ClickHouse-backed
until PR2), charts, dashboards, and team management."
```

---

## Task 3: Delete Connection model; Athena config from env; collapse Source kinds

**Goal:** Connection model is gone. Athena workgroup/region/output-location come from env. The `Source` model has a single `Table` kind replacing the four telemetry-specific kinds. Existing data layer still works (against ClickHouse via the in-tree `clickhouse/` modules) — Task 4 swaps in Athena.

**Files:**

Delete:
- `packages/api/src/models/connection.ts`
- `packages/api/src/routers/api/connections.ts`
- `packages/api/src/controllers/connection.ts`
- `packages/app/src/components/ConnectionForm.tsx`, `ConnectionSelect.tsx`
- `packages/app/src/connection.ts`
- Connection-related pages (look for any `pages/connections/` directory)

Modify:
- `packages/api/src/config.ts` — drop ClickHouse/OpAMP env vars; add Athena env vars
- `packages/api/src/models/source.ts` — collapse 4-kind discriminator to one `Table` kind
- `packages/common-utils/src/types.ts` — drop `LogSourceSchema`, `TraceSourceSchema`, `SessionSourceSchema`, `MetricSourceSchema`; add single `TableSourceSchema`
- `packages/api/src/models/user.ts` — add `role: 'admin' | 'editor' | 'viewer'` field, default `'admin'`
- `packages/api/src/routers/api/index.ts` — unregister `connectionsRouter`
- `packages/api/src/api-app.ts` — drop `app.use('/api/connections', ...)` registration
- `packages/api/src/setupDefaults.ts` — drop default-Connection bootstrap; keep default-Source if any
- `packages/api/src/routers/api/sources.ts` and `controllers/sources.ts` — drop Connection-ref fields, accept new Source shape
- `packages/app/src/source.ts` — drop 4-kind branching; use single Table kind
- `packages/app/src/DBSearchPage.tsx`, `DBChartPage.tsx`, `DBDashboardPage.tsx` — drop Connection picker (Task 9 / 11 finish their generalization)
- `packages/api/src/utils/zod.ts` — verify `objectIdSchema` still used after Connection removal
- `.env.example` — document new env vars
- Migration: write a Mongoose migration in `packages/api/migrations/<timestamp>-collapse-source-kinds.js` to convert any existing 4-kind Source records to single Table kind (best-effort; for fresh installs, irrelevant)

**Acceptance Criteria:**

- [ ] `packages/api/src/models/connection.ts` does not exist
- [ ] `Source` model has a single discriminator-key value (`Table`); old kinds (Log/Trace/Session/Metric) are no longer accepted
- [ ] `User` model has a `role` field with default `'admin'`; existing users default to `'admin'` after migration
- [ ] App boots when `ATHENA_REGION`, `ATHENA_WORKGROUP`, `ATHENA_OUTPUT_LOCATION` are set in env; fails fast with a clear error if any are missing
- [ ] No reference to `Connection` in API routes, app components, or types
- [ ] `make ci-lint` and `make ci-unit` pass

**Verify:**
```bash
grep -rn "Connection\b" packages/api/src --include="*.ts" | grep -v "// " | grep -v "test" | wc -l
```
Expected: 0 (or only references in deleted-file commit messages).

**Steps:**

- [ ] **Step 1: Update `packages/api/src/config.ts`**

Drop ClickHouse-related exports (`CLICKHOUSE_HOST`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `OPAMP_PORT`, `INGESTION_API_KEY`). Add:

```ts
function requireEnv(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Required env var ${name} is not set`);
  return v;
}

export const ATHENA_REGION = requireEnv('ATHENA_REGION');
export const ATHENA_WORKGROUP = requireEnv('ATHENA_WORKGROUP');
export const ATHENA_OUTPUT_LOCATION = requireEnv('ATHENA_OUTPUT_LOCATION');
export const ATHENA_SYNC_TIMEOUT_MS = Number.parseInt(
  env.ATHENA_SYNC_TIMEOUT_MS ?? '30000',
  10,
);
export const ATHENA_RESULT_REUSE_TTL_MIN = Number.parseInt(
  env.ATHENA_RESULT_REUSE_TTL_MIN ?? '60',
  10,
);
```

- [ ] **Step 2: Write the failing test for new Source model shape**

Create `packages/api/src/models/__tests__/source.test.ts` (or extend if exists):

```ts
import { Source } from '../source';
import { SourceKind } from '@berg/common-utils/dist/types';

describe('Source model', () => {
  it('accepts a Table-kind source with required fields', async () => {
    const teamId = new mongoose.Types.ObjectId();
    const doc = await Source.create({
      kind: SourceKind.Table,
      team: teamId,
      catalog: 's3tablescatalog/analytics-bucket',
      database: 'analytics_db',
      table: 'events',
      displayName: 'events',
    });
    expect(doc.kind).toBe(SourceKind.Table);
    expect(doc.catalog).toBe('s3tablescatalog/analytics-bucket');
  });

  it('accepts optional timestampColumn / defaultSort / defaultColumns', async () => {
    const teamId = new mongoose.Types.ObjectId();
    const doc = await Source.create({
      kind: SourceKind.Table,
      team: teamId,
      catalog: 's3tablescatalog/x',
      database: 'd',
      table: 't',
      displayName: 't',
      timestampColumn: 'event_time',
      defaultSort: 'event_time DESC',
      defaultColumns: ['a', 'b'],
    });
    expect(doc.timestampColumn).toBe('event_time');
  });

  it('rejects legacy Log kind', async () => {
    const teamId = new mongoose.Types.ObjectId();
    await expect(
      Source.create({ kind: 'Log', team: teamId } as never),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Update `packages/common-utils/src/types.ts`**

Replace the four `*SourceSchema` entries with a single `TableSourceSchema`:

```ts
export const SourceKind = {
  Table: 'Table',
} as const;
export type SourceKind = typeof SourceKind[keyof typeof SourceKind];

export const BaseSourceSchema = z.object({
  team: z.string(),
  name: z.string().optional(),
  from: z
    .object({
      databaseName: z.string(),
      tableName: z.string(),
    })
    .optional(),
  querySettings: z.array(z.object({ setting: z.string(), value: z.string() })).optional(),
});

export const TableSourceSchema = BaseSourceSchema.extend({
  kind: z.literal(SourceKind.Table),
  catalog: z.string().min(1),
  database: z.string().min(1),
  table: z.string().min(1),
  displayName: z.string().min(1),
  timestampColumn: z.string().optional(),
  defaultSort: z.string().optional(),
  defaultColumns: z.array(z.string()).optional(),
  lastQueriedAt: z.coerce.date().optional(),
});

export type TableSource = z.infer<typeof TableSourceSchema>;
```

Delete `LogSourceSchema`, `TraceSourceSchema`, `SessionSourceSchema`, `MetricSourceSchema` and any `MetricsDataType` enum unless used elsewhere (search and replace any usage).

- [ ] **Step 4: Update `packages/api/src/models/source.ts`**

Replace the discriminator setup with a single Table-kind schema:

```ts
import { TableSourceSchema, SourceKind } from '@berg/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import z from 'zod';

import { objectIdSchema } from '@/utils/zod';

export const ISourceSchema = TableSourceSchema.omit({ team: true }).extend({
  team: objectIdSchema,
});

export type ISource = z.infer<typeof ISourceSchema>;
export type SourceDocument = mongoose.HydratedDocument<ISource>;

const sourceSchema = new Schema<ISource>(
  {
    kind: { type: String, enum: [SourceKind.Table], required: true, default: SourceKind.Table },
    team: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Team' },
    catalog: { type: String, required: true, minlength: 1 },
    database: { type: String, required: true, minlength: 1 },
    table: { type: String, required: true, minlength: 1 },
    displayName: { type: String, required: true, minlength: 1 },
    timestampColumn: String,
    defaultSort: String,
    defaultColumns: [String],
    lastQueriedAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

export const Source = mongoose.model<ISource>('Source', sourceSchema);
```

- [ ] **Step 5: Run the source test, verify it passes**

```bash
cd packages/api && yarn ci:unit src/models/__tests__/source.test.ts
```
Expected: all three test cases pass.

- [ ] **Step 6: Update `packages/api/src/models/user.ts`**

Add the `role` field:

```ts
export interface IUser {
  _id: ObjectId;
  accessKey: string;
  createdAt: Date;
  email: string;
  name: string;
  team: ObjectId;
  role: 'admin' | 'editor' | 'viewer';   // Phase 2 hook; default 'admin' in v1
}
```

In the schema definition:
```ts
const UserSchema = new Schema(
  {
    name: String,
    email: { type: String, required: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    role: {
      type: String,
      enum: ['admin', 'editor', 'viewer'],
      default: 'admin',
      required: true,
    },
    accessKey: { type: String, default: function genUUID() { return uuidv4(); } },
  },
  { timestamps: true },
);
```

- [ ] **Step 7: Delete Connection model and dependents**

```bash
git rm packages/api/src/models/connection.ts \
       packages/api/src/routers/api/connections.ts \
       packages/api/src/controllers/connection.ts \
       packages/app/src/components/ConnectionForm.tsx \
       packages/app/src/components/ConnectionSelect.tsx \
       packages/app/src/connection.ts
```

Search for any remaining references and delete:
```bash
grep -rn "from.*connection" packages/api/src packages/app/src --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Update files that import Connection — typically these can drop the import and replace `connection.id` references with the new env-based config.

- [ ] **Step 8: Drop Connection registration from `routers/api/index.ts` and `api-app.ts`**

Remove `connectionsRouter` import and entry in `routers/api/index.ts`, and the corresponding `app.use(...)` line in `api-app.ts`.

- [ ] **Step 9: Update `packages/api/src/setupDefaults.ts`**

Remove any logic that bootstraps a default Connection (search for `Connection.create` or `defaultConnection`). If `DEFAULT_SOURCES` env-var bootstrap exists, update it to construct Table-kind sources only (drop kind branching).

- [ ] **Step 10: Update `packages/api/src/controllers/sources.ts`**

The existing controller assumes Sources have a `connection` ObjectId. Drop that requirement. Source CRUD now only validates the new shape (catalog/database/table/displayName + optional fields).

- [ ] **Step 11: Update `packages/app/src/source.ts`**

The hook `useSources` and its types must match the new shape. Drop any Connection-aware logic; types come from `@berg/common-utils/dist/types#TableSource`.

- [ ] **Step 12: Add migration**

Create `packages/api/migrations/202605040001-collapse-source-kinds.js`:

```js
module.exports = {
  async up(db) {
    // Convert any legacy Log/Trace/Session/Metric kind sources into Table kind.
    // Best-effort: derives catalog/database/table from existing `from` field.
    await db.collection('sources').updateMany(
      { kind: { $in: ['Log', 'Trace', 'Session', 'Metric'] } },
      [
        {
          $set: {
            kind: 'Table',
            catalog: 'AwsDataCatalog',
            database: { $ifNull: ['$from.databaseName', 'default'] },
            table: { $ifNull: ['$from.tableName', 'unknown'] },
            displayName: { $ifNull: ['$name', 'Untitled'] },
          },
        },
      ],
    );
    // Drop unused fields
    await db.collection('sources').updateMany(
      {},
      { $unset: { connection: '', from: '', /* telemetry-specific fields */ traceIdExpression: '', spanIdExpression: '' } },
    );
    // Drop the connections collection
    await db.collection('connections').drop().catch(() => {});
  },
  async down() {
    throw new Error('Down migration not supported.');
  },
};
```

Add a corresponding User migration if needed:

`packages/api/migrations/202605040002-add-user-role.js`:
```js
module.exports = {
  async up(db) {
    await db.collection('users').updateMany(
      { role: { $exists: false } },
      { $set: { role: 'admin' } },
    );
  },
  async down() {
    throw new Error('Down migration not supported.');
  },
};
```

- [ ] **Step 13: Document new env vars in `.env.example`**

Append:
```
# AWS Athena (Berg)
ATHENA_REGION=us-east-1
ATHENA_WORKGROUP=primary
ATHENA_OUTPUT_LOCATION=s3://my-bucket/athena-results/
ATHENA_SYNC_TIMEOUT_MS=30000
ATHENA_RESULT_REUSE_TTL_MIN=60
```

Remove:
```
CLICKHOUSE_HOST=
CLICKHOUSE_USER=
CLICKHOUSE_PASSWORD=
OPAMP_PORT=
```

- [ ] **Step 14: Run lint, unit, integration tests**

```bash
yarn build:common-utils
make ci-lint
make ci-unit
```

The api Source test from Step 2 should pass. Search/dashboard/chart code may still fail compile (we'll wire Athena in PR2). Fix only what's necessary to keep `make ci-lint` and `make ci-unit` green at the boundaries; defer Athena-only test fixes to PR2.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "refactor: delete Connection model, collapse Source kinds, Athena config from env

Source model is single Table kind: { catalog, database, table, displayName,
timestampColumn?, defaultSort?, defaultColumns? }. User gains a role field
(default 'admin') as a Phase 2 hook. Athena workgroup/region/output come
from env; Connection model and routes deleted. Migrations included for
existing data."
```

---

# PR2 — Data layer

## Task 4: Implement Athena query client in common-utils

**Goal:** A new `@berg/common-utils/athena` module provides synchronous and asynchronous query execution against AWS Athena, paginated result fetch, cancellation, type mapping, and clean error handling. Replaces `common-utils/clickhouse`.

**Files:**

Create:
- `packages/common-utils/src/athena/index.ts`
- `packages/common-utils/src/athena/types.ts`
- `packages/common-utils/src/athena/typeMapping.ts`
- `packages/common-utils/src/__tests__/athena.test.ts`

Delete:
- `packages/common-utils/src/clickhouse/` (entire directory)
- `packages/common-utils/src/__tests__/clickhouse.test.ts`

Modify:
- `packages/common-utils/package.json` — add `@aws-sdk/client-athena` dependency, remove `@clickhouse/client*`
- `packages/common-utils/src/index.ts` — re-export from `athena` instead of `clickhouse` (if existing index re-exports anything)
- `packages/common-utils/src/clickhouse.ts` (if exists) — delete or replace

**Acceptance Criteria:**

- [ ] `executeSync(sql, opts)` returns `{ rows, schema, scannedBytes, executionId, status }` for completed queries
- [ ] `executeSync` returns `{ executionId, status: 'running' }` if query exceeds the sync timeout
- [ ] `executeAsync(sql, opts)` returns `{ executionId }` immediately
- [ ] `getStatus(executionId)` returns one of `'queued' | 'running' | 'finished' | 'failed' | 'cancelled'`
- [ ] `getResults(executionId, nextToken?)` returns `{ rows, schema, scannedBytes, nextToken? }` paged
- [ ] `cancel(executionId)` invokes `StopQueryExecution`
- [ ] All queries pass `ResultReuseConfiguration { Enabled: true, ExpirationInMinutes }`
- [ ] No retries on user errors (syntax, AccessDenied, column-not-found); retries with exponential backoff on `ThrottlingException`/`InternalServerException` (max 3)
- [ ] Trino → JS type mapping covers: VARCHAR, CHAR, TINYINT/SMALLINT/INTEGER/BIGINT, REAL/DOUBLE/DECIMAL, BOOLEAN, DATE, TIME, TIMESTAMP, TIMESTAMP WITH TIME ZONE, ARRAY, MAP, ROW, JSON
- [ ] Unit test coverage for happy path, sync-timeout-to-async, cancel, all error mappings, type conversions

**Verify:** `cd packages/common-utils && yarn ci:unit src/__tests__/athena.test.ts` → all assertions pass.

**Steps:**

- [ ] **Step 1: Add the AWS SDK dependency**

```bash
cd packages/common-utils
yarn add @aws-sdk/client-athena
yarn remove @clickhouse/client @clickhouse/client-web 2>/dev/null || true
```

- [ ] **Step 2: Write `packages/common-utils/src/athena/types.ts`**

```ts
export type AthenaQueryStatus = 'queued' | 'running' | 'finished' | 'failed' | 'cancelled';

export interface AthenaColumn {
  name: string;
  type: string;            // raw Trino type string
  jsType: string;          // mapped JS type label (string|number|boolean|date|array|map|row|json)
}

export interface AthenaQueryResult {
  rows: Record<string, unknown>[];
  schema: AthenaColumn[];
  scannedBytes: number;
  executionId: string;
  status: AthenaQueryStatus;
  nextToken?: string;
}

export interface ExecuteOptions {
  workgroup: string;
  outputLocation: string;
  region: string;
  resultReuseTtlMin?: number;
  syncTimeoutMs?: number;     // for executeSync only
  signal?: AbortSignal;
}

export interface AthenaError extends Error {
  code:
    | 'access_denied'
    | 'column_not_found'
    | 'syntax_error'
    | 'table_not_found'
    | 'throttled'
    | 'internal'
    | 'timeout'
    | 'unknown';
  retryable: boolean;
}
```

- [ ] **Step 3: Write the failing test for type mapping**

`packages/common-utils/src/__tests__/athena.test.ts`:

```ts
import { convertTrinoTypeToJsType } from '../athena/typeMapping';

describe('convertTrinoTypeToJsType', () => {
  it.each([
    ['varchar', 'string'],
    ['char(10)', 'string'],
    ['tinyint', 'number'],
    ['smallint', 'number'],
    ['integer', 'number'],
    ['bigint', 'number'],
    ['real', 'number'],
    ['double', 'number'],
    ['decimal(10,2)', 'number'],
    ['boolean', 'boolean'],
    ['date', 'date'],
    ['time', 'date'],
    ['timestamp', 'date'],
    ['timestamp with time zone', 'date'],
    ['array(varchar)', 'array'],
    ['map(varchar, integer)', 'map'],
    ['row(a varchar, b integer)', 'row'],
    ['json', 'json'],
  ])('maps %s to %s', (trino, expected) => {
    expect(convertTrinoTypeToJsType(trino)).toBe(expected);
  });

  it('handles uppercase', () => {
    expect(convertTrinoTypeToJsType('VARCHAR')).toBe('string');
  });
});
```

Run:
```bash
yarn ci:unit src/__tests__/athena.test.ts
```
Expected: FAIL — module does not exist yet.

- [ ] **Step 4: Implement `packages/common-utils/src/athena/typeMapping.ts`**

```ts
export type AthenaJsType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'map' | 'row' | 'json' | 'unknown';

export function convertTrinoTypeToJsType(trinoType: string): AthenaJsType {
  const t = trinoType.trim().toLowerCase();
  if (t.startsWith('varchar') || t.startsWith('char')) return 'string';
  if (t.startsWith('tinyint') || t.startsWith('smallint') ||
      t.startsWith('integer') || t.startsWith('bigint') ||
      t.startsWith('real') || t.startsWith('double') || t.startsWith('decimal')) {
    return 'number';
  }
  if (t === 'boolean') return 'boolean';
  if (t.startsWith('date') || t.startsWith('time') || t.startsWith('timestamp')) return 'date';
  if (t.startsWith('array')) return 'array';
  if (t.startsWith('map')) return 'map';
  if (t.startsWith('row')) return 'row';
  if (t === 'json') return 'json';
  return 'unknown';
}

export function convertCellValue(raw: string | null | undefined, jsType: AthenaJsType): unknown {
  if (raw == null) return null;
  switch (jsType) {
    case 'number': return Number(raw);
    case 'boolean': return raw === 'true';
    case 'date': return raw;          // ISO string; consumer converts to Date if needed
    case 'array':
    case 'map':
    case 'row':
    case 'json':
      try { return JSON.parse(raw); } catch { return raw; }
    case 'string':
    default: return raw;
  }
}
```

- [ ] **Step 5: Run the type-mapping test, verify it passes**

```bash
yarn ci:unit src/__tests__/athena.test.ts
```
Expected: PASS for all type cases.

- [ ] **Step 6: Write the failing test for `executeSync` happy path**

Add to the same test file:

```ts
import { mockClient } from 'aws-sdk-client-mock';
import {
  AthenaClient as SdkAthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} from '@aws-sdk/client-athena';
import { AthenaClient } from '../athena';

const sdkMock = mockClient(SdkAthenaClient);

beforeEach(() => sdkMock.reset());

describe('AthenaClient.executeSync', () => {
  it('returns results when the query finishes within the timeout', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-1' });
    sdkMock
      .on(GetQueryExecutionCommand)
      .resolves({
        QueryExecution: {
          Status: { State: 'SUCCEEDED' },
          Statistics: { DataScannedInBytes: 1024 },
        },
      });
    sdkMock
      .on(GetQueryResultsCommand)
      .resolves({
        ResultSet: {
          ResultSetMetadata: {
            ColumnInfo: [
              { Name: 'id', Type: 'integer' },
              { Name: 'name', Type: 'varchar' },
            ],
          },
          Rows: [
            { Data: [{ VarCharValue: 'id' }, { VarCharValue: 'name' }] },
            { Data: [{ VarCharValue: '1' }, { VarCharValue: 'alice' }] },
          ],
        },
      });

    const client = new AthenaClient({ region: 'us-east-1' });
    const result = await client.executeSync('SELECT id, name FROM users', {
      workgroup: 'primary',
      outputLocation: 's3://b/r/',
      region: 'us-east-1',
      syncTimeoutMs: 5000,
    });

    expect(result.executionId).toBe('exec-1');
    expect(result.status).toBe('finished');
    expect(result.scannedBytes).toBe(1024);
    expect(result.rows).toEqual([{ id: 1, name: 'alice' }]);
    expect(result.schema).toEqual([
      { name: 'id', type: 'integer', jsType: 'number' },
      { name: 'name', type: 'varchar', jsType: 'string' },
    ]);
  });
});
```

Run, expect FAIL.

- [ ] **Step 7: Implement `packages/common-utils/src/athena/index.ts`**

```ts
import {
  AthenaClient as SdkAthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StopQueryExecutionCommand,
  AthenaServiceException,
} from '@aws-sdk/client-athena';

import {
  AthenaQueryStatus, AthenaQueryResult, ExecuteOptions, AthenaError, AthenaColumn,
} from './types';
import { convertTrinoTypeToJsType, convertCellValue, AthenaJsType } from './typeMapping';

const STATE_MAP: Record<string, AthenaQueryStatus> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'finished',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export class AthenaClient {
  private sdk: SdkAthenaClient;
  constructor(opts: { region: string }) {
    this.sdk = new SdkAthenaClient({ region: opts.region });
  }

  async executeSync(sql: string, opts: ExecuteOptions): Promise<AthenaQueryResult> {
    const id = await this.startQuery(sql, opts);
    const finishedBy = Date.now() + (opts.syncTimeoutMs ?? 30000);
    let delay = 250;
    while (Date.now() < finishedBy) {
      const status = await this.getStatus(id);
      if (status === 'finished') {
        return this.getResults(id);
      }
      if (status === 'failed' || status === 'cancelled') {
        throw await this.fetchExecutionError(id, status);
      }
      await new Promise(r => setTimeout(r, Math.min(delay, 2000)));
      delay = Math.min(delay * 1.5, 2000);
    }
    return { rows: [], schema: [], scannedBytes: 0, executionId: id, status: 'running' };
  }

  async executeAsync(sql: string, opts: ExecuteOptions): Promise<{ executionId: string }> {
    const executionId = await this.startQuery(sql, opts);
    return { executionId };
  }

  async getStatus(executionId: string): Promise<AthenaQueryStatus> {
    const r = await this.sdk.send(new GetQueryExecutionCommand({ QueryExecutionId: executionId }));
    const state = r.QueryExecution?.Status?.State ?? 'QUEUED';
    return STATE_MAP[state] ?? 'queued';
  }

  async getResults(executionId: string, nextToken?: string): Promise<AthenaQueryResult> {
    const exec = await this.sdk.send(new GetQueryExecutionCommand({ QueryExecutionId: executionId }));
    const scannedBytes = Number(exec.QueryExecution?.Statistics?.DataScannedInBytes ?? 0);
    const state = exec.QueryExecution?.Status?.State ?? 'QUEUED';
    const status = STATE_MAP[state] ?? 'queued';

    const r = await this.sdk.send(new GetQueryResultsCommand({
      QueryExecutionId: executionId,
      NextToken: nextToken,
      MaxResults: 1000,
    }));

    const colInfo = r.ResultSet?.ResultSetMetadata?.ColumnInfo ?? [];
    const schema: AthenaColumn[] = colInfo.map(c => ({
      name: c.Name ?? '',
      type: c.Type ?? 'varchar',
      jsType: convertTrinoTypeToJsType(c.Type ?? 'varchar'),
    }));

    // First row is the header repeat for first page; skip when no nextToken passed
    const rawRows = r.ResultSet?.Rows ?? [];
    const dataRows = nextToken == null ? rawRows.slice(1) : rawRows;
    const rows = dataRows.map(row => {
      const out: Record<string, unknown> = {};
      schema.forEach((col, i) => {
        out[col.name] = convertCellValue(
          row.Data?.[i]?.VarCharValue,
          col.jsType as AthenaJsType,
        );
      });
      return out;
    });

    return {
      rows,
      schema,
      scannedBytes,
      executionId,
      status,
      nextToken: r.NextToken,
    };
  }

  async cancel(executionId: string): Promise<void> {
    await this.sdk.send(new StopQueryExecutionCommand({ QueryExecutionId: executionId }));
  }

  private async startQuery(sql: string, opts: ExecuteOptions): Promise<string> {
    const r = await this.sdk.send(new StartQueryExecutionCommand({
      QueryString: sql,
      WorkGroup: opts.workgroup,
      ResultConfiguration: { OutputLocation: opts.outputLocation },
      ResultReuseConfiguration: {
        ResultReuseByAgeConfiguration: {
          Enabled: true,
          MaxAgeInMinutes: opts.resultReuseTtlMin ?? 60,
        },
      },
    }));
    if (!r.QueryExecutionId) throw this.makeError('unknown', 'No QueryExecutionId returned');
    return r.QueryExecutionId;
  }

  private async fetchExecutionError(id: string, status: 'failed' | 'cancelled'): Promise<AthenaError> {
    const exec = await this.sdk.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const reason = exec.QueryExecution?.Status?.StateChangeReason ?? `Query ${status}`;
    return this.classifyAthenaError(reason);
  }

  private classifyAthenaError(message: string): AthenaError {
    const m = message.toLowerCase();
    if (m.includes('access denied')) return this.makeError('access_denied', message, false);
    if (m.includes('column') && m.includes('not exist')) return this.makeError('column_not_found', message, false);
    if (m.includes('table') && m.includes('not found')) return this.makeError('table_not_found', message, false);
    if (m.includes('syntax error')) return this.makeError('syntax_error', message, false);
    if (m.includes('throttl')) return this.makeError('throttled', message, true);
    return this.makeError('unknown', message, false);
  }

  private makeError(code: AthenaError['code'], message: string, retryable = false): AthenaError {
    const err = new Error(message) as AthenaError;
    err.code = code;
    err.retryable = retryable;
    return err;
  }
}
```

- [ ] **Step 8: Run the executeSync test, verify it passes**

```bash
yarn ci:unit src/__tests__/athena.test.ts
```
Expected: type-mapping tests + executeSync happy-path test all pass.

- [ ] **Step 9: Add tests for sync-timeout-to-async, cancel, error mapping**

```ts
describe('AthenaClient.executeSync timeout fallback', () => {
  it('returns running status when timeout elapses before finish', async () => {
    sdkMock.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'exec-2' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: { Status: { State: 'RUNNING' } },
    });

    const client = new AthenaClient({ region: 'us-east-1' });
    const start = Date.now();
    const result = await client.executeSync('SELECT 1', {
      workgroup: 'wg', outputLocation: 's3://b/', region: 'us-east-1', syncTimeoutMs: 500,
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(500);
    expect(result.status).toBe('running');
    expect(result.executionId).toBe('exec-2');
  });
});

describe('AthenaClient.cancel', () => {
  it('invokes StopQueryExecution', async () => {
    sdkMock.on(StopQueryExecutionCommand).resolves({});
    const client = new AthenaClient({ region: 'us-east-1' });
    await client.cancel('exec-3');
    const calls = sdkMock.commandCalls(StopQueryExecutionCommand);
    expect(calls.length).toBe(1);
    expect(calls[0].args[0].input.QueryExecutionId).toBe('exec-3');
  });
});

describe('AthenaClient error classification', () => {
  it('classifies AccessDenied as access_denied (non-retryable)', async () => {
    sdkMock.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'exec-4' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: { State: 'FAILED', StateChangeReason: 'AccessDenied: ...' },
      },
    });
    const client = new AthenaClient({ region: 'us-east-1' });
    await expect(client.executeSync('SELECT 1', {
      workgroup: 'wg', outputLocation: 's3://b/', region: 'us-east-1', syncTimeoutMs: 5000,
    })).rejects.toMatchObject({ code: 'access_denied', retryable: false });
  });
});
```

Run all tests, fix until green:
```bash
yarn ci:unit src/__tests__/athena.test.ts
```

- [ ] **Step 10: Delete old clickhouse module**

```bash
git rm -r packages/common-utils/src/clickhouse \
          packages/common-utils/src/__tests__/clickhouse.test.ts
```

If `packages/common-utils/src/index.ts` re-exports from `clickhouse`, replace with `export * from './athena';`.

- [ ] **Step 11: Build and lint**

```bash
yarn build:common-utils
make ci-lint
make ci-unit
```

Expect compile errors in api/app where ClickHouse client was referenced — leave as-is for now; Tasks 5/7/9/11 fix them. The clickhouse.test.ts deletion may cause some snapshot orphans; clean those up.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(common-utils): Athena query client replacing ClickHouse

New @berg/common-utils/athena module exposes AthenaClient with executeSync
(internal polling + timeout fallback), executeAsync, getStatus, getResults
(paginated via NextToken), cancel. Trino → JS type mapping helper covers
primitives + ARRAY/MAP/ROW/JSON. Errors classified with retryable flag
(only ThrottlingException retried; user errors surface directly).

Pod's IRSA identity is used implicitly (no creds in code).

Replaces packages/common-utils/src/clickhouse/ entirely."
```

---

## Task 5: Port Lucene parser to emit Trino SQL

**Goal:** A new `TrinoSchemaSerializer` subclass of `SQLSerializer` (existing abstract class in `queryParser.ts`) emits Trino-compatible SQL. The ClickHouse-specific subclass `CustomSchemaSQLSerializerV2` is removed once the codebase no longer references it.

**Files:**
- Modify: `packages/common-utils/src/queryParser.ts`
- Modify: `packages/common-utils/src/sqlFormatter.ts` (date/time helpers)
- Modify: `packages/common-utils/src/__tests__/queryParser.test.ts` (assertions become Trino-shaped)
- Delete (eventually, after all callers migrated): `CustomSchemaSQLSerializerV2` class definition and ClickHouse-only helpers (`toUnixTimestamp64Milli`, `toStartOfInterval`, `parseDateTimeBestEffort`)

**Acceptance Criteria:**

- [ ] `TrinoSchemaSerializer` exists, extends `SQLSerializer`, and is exported
- [ ] All existing parser test cases compile and pass with Trino-shaped expected SQL
- [ ] Lucene `field:value` against a string column emits `lower(field) LIKE lower('%value%')` (or chosen normalization)
- [ ] Lucene range queries emit Trino-compatible BETWEEN with proper interval syntax
- [ ] Time bucketing uses `date_trunc('minute', ts)` (not ClickHouse `toStartOfInterval`)
- [ ] JSON path queries emit `json_extract_scalar(field, '$.path')`
- [ ] Regex emits `regexp_like(field, pattern)`
- [ ] Lucene parser validates against the supplied schema before SQL emit; unknown column raises a parse error with column name
- [ ] When `timestampColumn` is unset on the supplied source, time-window WHERE is omitted

**Verify:** `cd packages/common-utils && yarn ci:unit src/__tests__/queryParser.test.ts` passes.

**Steps:**

- [ ] **Step 1: Read the existing parser structure**

Skim `packages/common-utils/src/queryParser.ts` and `__tests__/queryParser.test.ts`. Note:
- Line 387: `abstract class SQLSerializer`
- Line 806: `class CustomSchemaSQLSerializerV2 extends SQLSerializer`
- Line 1508: `export async function genWhereSQL`
- Line 1515: `export class SearchQueryBuilder`

The test file uses snapshot-style assertions for emitted SQL.

- [ ] **Step 2: Write a failing test for the Trino emitter**

Append to `packages/common-utils/src/__tests__/queryParser.test.ts`:

```ts
import { TrinoSchemaSerializer, parse } from '../queryParser';

describe('TrinoSchemaSerializer', () => {
  const schema = {
    columns: [
      { name: 'level', type: 'varchar' },
      { name: 'host', type: 'varchar' },
      { name: 'event_time', type: 'timestamp' },
      { name: 'count', type: 'bigint' },
    ],
    timestampColumn: 'event_time',
  };

  it('emits Trino-flavored LIKE for free-text matches', () => {
    const ast = parse('error');
    const serializer = new TrinoSchemaSerializer(schema);
    const sql = serializer.serialize(ast);
    expect(sql).toContain("lower(level) LIKE lower('%error%')");
  });

  it('emits range with INTERVAL syntax', () => {
    const ast = parse('count:>=10 AND count:<100');
    const sql = new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).toContain('count >= 10');
    expect(sql).toContain('count < 100');
  });

  it('emits date_trunc for time bucketing in genWhereSQL', () => {
    // We're not testing bucketing here directly — bucketing happens in chart config.
    // But the serializer must use Trino-compatible time functions when called from chart paths.
    const ast = parse('level:error');
    const sql = new TrinoSchemaSerializer(schema).serialize(ast);
    expect(sql).not.toContain('toStartOfInterval');
  });

  it('rejects unknown columns', () => {
    const ast = parse('nope:foo');
    expect(() => new TrinoSchemaSerializer(schema).serialize(ast))
      .toThrow(/column.*nope.*not.*found/i);
  });

  it('handles Source without timestampColumn (no time-window injection)', () => {
    const noTimeSchema = { ...schema, timestampColumn: undefined };
    const ast = parse('level:error');
    const sql = new TrinoSchemaSerializer(noTimeSchema).serialize(ast);
    expect(sql).not.toMatch(/event_time\s+BETWEEN/);
  });
});
```

Run, expect FAIL.

- [ ] **Step 3: Implement `TrinoSchemaSerializer`**

In `packages/common-utils/src/queryParser.ts`, after the abstract `SQLSerializer` class:

```ts
export interface TrinoSchemaConfig {
  columns: Array<{ name: string; type: string }>;
  timestampColumn?: string;
  timeRange?: { startMs: number; endMs: number };
}

export class TrinoSchemaSerializer extends SQLSerializer {
  constructor(private schema: TrinoSchemaConfig) {
    super();
  }

  protected escapeIdentifier(name: string): string {
    if (!this.schema.columns.find(c => c.name === name)) {
      throw new Error(`Column ${name} not found in schema`);
    }
    return `"${name.replace(/"/g, '""')}"`;
  }

  protected escapeStringLiteral(v: string): string {
    return `'${v.replace(/'/g, "''")}'`;
  }

  protected emitTermMatch(field: string, value: string): string {
    const col = this.escapeIdentifier(field);
    return `lower(${col}) LIKE lower(${this.escapeStringLiteral('%' + value + '%')})`;
  }

  protected emitFreeTextMatch(value: string): string {
    // Match across all string columns of the schema (similar to HyperDX's behavior).
    const stringCols = this.schema.columns.filter(c =>
      c.type.toLowerCase().startsWith('varchar') || c.type.toLowerCase().startsWith('char'),
    );
    if (stringCols.length === 0) return 'true';
    const cs = stringCols
      .map(c => `lower(${this.escapeIdentifier(c.name)}) LIKE lower(${this.escapeStringLiteral('%' + value + '%')})`)
      .join(' OR ');
    return `(${cs})`;
  }

  protected emitRangeOp(field: string, op: '<'|'<='|'>'|'>='|'='|'!=', literal: string): string {
    const col = this.escapeIdentifier(field);
    const colType = this.schema.columns.find(c => c.name === field)?.type.toLowerCase() ?? 'varchar';
    const isNumeric = ['tinyint','smallint','integer','bigint','real','double','decimal']
      .some(p => colType.startsWith(p));
    const rhs = isNumeric ? literal : this.escapeStringLiteral(literal);
    return `${col} ${op} ${rhs}`;
  }

  protected emitJsonPathExtract(field: string, path: string): string {
    const col = this.escapeIdentifier(field);
    return `json_extract_scalar(${col}, ${this.escapeStringLiteral('$.' + path)})`;
  }

  protected emitRegexMatch(field: string, pattern: string): string {
    const col = this.escapeIdentifier(field);
    return `regexp_like(${col}, ${this.escapeStringLiteral(pattern)})`;
  }

  protected emitTimeWindow(): string | null {
    if (!this.schema.timestampColumn || !this.schema.timeRange) return null;
    const col = this.escapeIdentifier(this.schema.timestampColumn);
    const startSecs = Math.floor(this.schema.timeRange.startMs / 1000);
    const endSecs = Math.floor(this.schema.timeRange.endMs / 1000);
    return `${col} BETWEEN from_unixtime(${startSecs}) AND from_unixtime(${endSecs})`;
  }
}
```

(The exact `serialize()` signature and template-method hooks come from the existing abstract `SQLSerializer`. Mirror the structure of `CustomSchemaSQLSerializerV2` — read its body first to see what hooks need overriding.)

- [ ] **Step 4: Update `sqlFormatter.ts` time helpers for Trino**

```ts
export function trinoTimeBucket(column: string, interval: string): string {
  // interval like 'minute', 'hour', 'day'
  return `date_trunc('${interval}', ${column})`;
}

export function trinoNow(): string {
  return 'now()';
}

export function trinoInterval(amount: number, unit: 'second'|'minute'|'hour'|'day'): string {
  return `INTERVAL '${amount}' ${unit.toUpperCase()}`;
}
```

(Place near existing time-formatting helpers; leave ClickHouse versions in place until Task 7/9/11 finish migrating callers.)

- [ ] **Step 5: Run tests**

```bash
yarn ci:unit src/__tests__/queryParser.test.ts
```
Iterate until the new Trino tests pass. Don't worry about the old ClickHouse tests yet — convert them in Step 6.

- [ ] **Step 6: Convert existing ClickHouse-emitter tests to Trino-emitter assertions**

For each test in `queryParser.test.ts` that currently checks ClickHouse SQL output:
- Replace `CustomSchemaSQLSerializerV2` with `TrinoSchemaSerializer`
- Update expected SQL strings to Trino syntax (e.g., `position(...)` → `strpos(...)`, `toStartOfInterval` → `date_trunc`, intervals → `INTERVAL '...' UNIT`)

Where the original test asserts on ClickHouse-specific behavior that doesn't apply to Trino (e.g., LowCardinality wrapping), delete that test.

- [ ] **Step 7: Update callers in `genWhereSQL` and `SearchQueryBuilder`**

Search for `CustomSchemaSQLSerializerV2` references:
```bash
grep -rn "CustomSchemaSQLSerializerV2" packages
```
Replace each with `TrinoSchemaSerializer`. The constructor argument shape changes — the new schema arg is `{ columns, timestampColumn?, timeRange? }` instead of the ClickHouse-specific config. Adapt callers.

- [ ] **Step 8: Delete `CustomSchemaSQLSerializerV2`**

Once nothing references it:
```bash
grep -rn "CustomSchemaSQLSerializerV2" packages
```
returns nothing. Delete the class from `queryParser.ts`. Delete `toUnixTimestamp64Milli`, `toStartOfInterval`, `parseDateTimeBestEffort` and other ClickHouse-only helpers in the same file and `sqlFormatter.ts`.

- [ ] **Step 9: Run full unit suite**

```bash
yarn build:common-utils
cd packages/common-utils && yarn ci:unit
```

Fix any remaining failures. Some tests in `renderChartConfig.test.ts` may check for ClickHouse SQL emission — update those assertions to Trino as well.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(common-utils): port Lucene parser emitter from ClickHouse to Trino

Add TrinoSchemaSerializer extending SQLSerializer; emits Trino-compatible
SQL with column-level type awareness, free-text matching across string
columns, regex via regexp_like, JSON path via json_extract_scalar, and
optional time-window injection when timestampColumn is set.

Delete CustomSchemaSQLSerializerV2 and ClickHouse-only time helpers
(toUnixTimestamp64Milli, toStartOfInterval, parseDateTimeBestEffort).
All parser tests rewritten to assert Trino output; renderChartConfig
tests updated where they depended on ClickHouse syntax.

Unknown columns raise a parse error before SQL hits Athena."
```

---

## Task 6: Implement Glue catalog discovery

**Goal:** A new `@berg/common-utils/glue` module wraps the AWS Glue Data Catalog SDK to list catalogs / databases / tables and fetch table schemas. Visibility filtering is implicit via the pod's IAM role.

**Files:**

Create:
- `packages/common-utils/src/glue/index.ts`
- `packages/common-utils/src/glue/types.ts`
- `packages/common-utils/src/__tests__/glue.test.ts`

Modify:
- `packages/common-utils/package.json` — add `@aws-sdk/client-glue`

**Acceptance Criteria:**

- [ ] `listCatalogs()` returns names of catalogs the IAM role can access (filtered to Iceberg-typed)
- [ ] `listDatabases(catalogId)` paginates via NextToken transparently; returns full list
- [ ] `listTables(catalogId, database)` paginates; returns table names + types
- [ ] `getTableSchema(catalogId, database, table)` returns `{ columns, partitionKeys, format, location, tableType }`
- [ ] AccessDenied results in silent filtering (browse views) but explicit error on direct fetch
- [ ] Unit tests cover happy path, pagination, AccessDenied filtering, EntityNotFound

**Verify:** `cd packages/common-utils && yarn ci:unit src/__tests__/glue.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Add the Glue SDK dependency**

```bash
cd packages/common-utils
yarn add @aws-sdk/client-glue
```

- [ ] **Step 2: Write `packages/common-utils/src/glue/types.ts`**

```ts
export interface GlueColumn {
  name: string;
  type: string;            // raw Trino type as Glue reports it
  comment?: string;
  isPartition: boolean;
}

export interface GlueTableSchema {
  catalogId: string;
  database: string;
  table: string;
  columns: GlueColumn[];
  partitionKeys: string[];
  format: 'iceberg' | 'parquet' | 'orc' | 'csv' | 'unknown';
  location: string;
  tableType: 'EXTERNAL_TABLE' | 'VIRTUAL_VIEW' | 'MANAGED_TABLE' | 'GOVERNED' | string;
}

export interface GlueTableSummary {
  database: string;
  table: string;
  format: GlueTableSchema['format'];
  tableType: string;
}
```

- [ ] **Step 3: Write the failing test for `listDatabases` with pagination**

`packages/common-utils/src/__tests__/glue.test.ts`:

```ts
import { mockClient } from 'aws-sdk-client-mock';
import {
  GlueClient as SdkGlueClient,
  GetDatabasesCommand,
  GetTablesCommand,
  GetTableCommand,
} from '@aws-sdk/client-glue';
import { GlueCatalogClient } from '../glue';

const sdk = mockClient(SdkGlueClient);
beforeEach(() => sdk.reset());

describe('GlueCatalogClient.listDatabases', () => {
  it('paginates via NextToken', async () => {
    sdk
      .on(GetDatabasesCommand)
      .resolvesOnce({ DatabaseList: [{ Name: 'db1' }, { Name: 'db2' }], NextToken: 'tok' })
      .resolvesOnce({ DatabaseList: [{ Name: 'db3' }], NextToken: undefined });
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const list = await c.listDatabases('catId');
    expect(list).toEqual(['db1', 'db2', 'db3']);
  });

  it('filters AccessDenied silently', async () => {
    sdk.on(GetDatabasesCommand).rejects(Object.assign(
      new Error('AccessDenied: ...'), { name: 'AccessDeniedException' },
    ));
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const list = await c.listDatabases('catId');
    expect(list).toEqual([]);
  });
});

describe('GlueCatalogClient.getTableSchema', () => {
  it('returns columns, partitionKeys, format, location', async () => {
    sdk.on(GetTableCommand).resolves({
      Table: {
        Name: 'events',
        TableType: 'EXTERNAL_TABLE',
        Parameters: { table_type: 'ICEBERG' },
        StorageDescriptor: {
          Location: 's3://bucket/events/',
          Columns: [
            { Name: 'event_id', Type: 'varchar' },
            { Name: 'event_time', Type: 'timestamp' },
          ],
        },
        PartitionKeys: [{ Name: 'event_date', Type: 'date' }],
      },
    });
    const c = new GlueCatalogClient({ region: 'us-east-1' });
    const schema = await c.getTableSchema('catId', 'analytics_db', 'events');
    expect(schema.columns).toEqual([
      { name: 'event_id', type: 'varchar', isPartition: false },
      { name: 'event_time', type: 'timestamp', isPartition: false },
      { name: 'event_date', type: 'date', isPartition: true },
    ]);
    expect(schema.partitionKeys).toEqual(['event_date']);
    expect(schema.format).toBe('iceberg');
    expect(schema.location).toBe('s3://bucket/events/');
  });
});
```

Run, expect FAIL.

- [ ] **Step 4: Implement `packages/common-utils/src/glue/index.ts`**

```ts
import {
  GlueClient as SdkGlueClient,
  GetDatabasesCommand,
  GetTablesCommand,
  GetTableCommand,
  ListSchemasCommand,
  AccessDeniedException,
  EntityNotFoundException,
} from '@aws-sdk/client-glue';

import { GlueColumn, GlueTableSchema, GlueTableSummary } from './types';

export class GlueCatalogClient {
  private sdk: SdkGlueClient;

  constructor(opts: { region: string }) {
    this.sdk = new SdkGlueClient({ region: opts.region });
  }

  async listCatalogs(): Promise<string[]> {
    // Today: the default account-level catalog plus any registered S3 Tables catalogs.
    // Glue exposes catalogs via GetCatalog/GetCatalogs depending on account setup.
    // For v1 we read from an env-allowlist or the default catalog; placeholder returns ['AwsDataCatalog'].
    return ['AwsDataCatalog'];
  }

  async listDatabases(catalogId: string): Promise<string[]> {
    const out: string[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const r = await this.sdk.send(new GetDatabasesCommand({
          CatalogId: catalogId === 'AwsDataCatalog' ? undefined : catalogId,
          NextToken: nextToken,
        }));
        for (const db of r.DatabaseList ?? []) {
          if (db.Name) out.push(db.Name);
        }
        nextToken = r.NextToken;
      } while (nextToken);
      return out;
    } catch (e) {
      if (e instanceof AccessDeniedException || (e as Error).name === 'AccessDeniedException') {
        return [];
      }
      throw e;
    }
  }

  async listTables(catalogId: string, database: string): Promise<GlueTableSummary[]> {
    const out: GlueTableSummary[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const r = await this.sdk.send(new GetTablesCommand({
          CatalogId: catalogId === 'AwsDataCatalog' ? undefined : catalogId,
          DatabaseName: database,
          NextToken: nextToken,
        }));
        for (const t of r.TableList ?? []) {
          out.push({
            database,
            table: t.Name ?? '',
            tableType: t.TableType ?? 'unknown',
            format: this.detectFormat(t.Parameters, t.StorageDescriptor?.SerdeInfo),
          });
        }
        nextToken = r.NextToken;
      } while (nextToken);
      return out;
    } catch (e) {
      if ((e as Error).name === 'AccessDeniedException') return [];
      throw e;
    }
  }

  async getTableSchema(catalogId: string, database: string, table: string): Promise<GlueTableSchema> {
    const r = await this.sdk.send(new GetTableCommand({
      CatalogId: catalogId === 'AwsDataCatalog' ? undefined : catalogId,
      DatabaseName: database,
      Name: table,
    }));
    if (!r.Table) {
      throw Object.assign(new Error(`Table ${table} not found`), { name: 'EntityNotFoundException' });
    }
    const t = r.Table;
    const cols: GlueColumn[] = (t.StorageDescriptor?.Columns ?? []).map(c => ({
      name: c.Name ?? '',
      type: c.Type ?? 'varchar',
      comment: c.Comment ?? undefined,
      isPartition: false,
    }));
    const partitionCols: GlueColumn[] = (t.PartitionKeys ?? []).map(c => ({
      name: c.Name ?? '',
      type: c.Type ?? 'varchar',
      isPartition: true,
    }));
    return {
      catalogId,
      database,
      table,
      columns: [...cols, ...partitionCols],
      partitionKeys: (t.PartitionKeys ?? []).map(p => p.Name ?? ''),
      format: this.detectFormat(t.Parameters, t.StorageDescriptor?.SerdeInfo),
      location: t.StorageDescriptor?.Location ?? '',
      tableType: t.TableType ?? 'unknown',
    };
  }

  private detectFormat(params?: Record<string, string>, serde?: { SerializationLibrary?: string }): GlueTableSchema['format'] {
    if (params?.table_type?.toUpperCase() === 'ICEBERG') return 'iceberg';
    const lib = serde?.SerializationLibrary?.toLowerCase() ?? '';
    if (lib.includes('parquet')) return 'parquet';
    if (lib.includes('orc')) return 'orc';
    if (lib.includes('csv') || lib.includes('opencsv')) return 'csv';
    return 'unknown';
  }
}
```

- [ ] **Step 5: Run the tests**

```bash
yarn ci:unit src/__tests__/glue.test.ts
```
Expected: PASS for both tests.

- [ ] **Step 6: Add tests for `listTables` and edge cases**

Add `listTables` happy-path test, EntityNotFoundException test on `getTableSchema`, format detection test (Parquet vs Iceberg).

- [ ] **Step 7: Build and lint**

```bash
yarn build:common-utils
make ci-lint
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(common-utils): Glue Data Catalog discovery client

GlueCatalogClient exposes listDatabases (paginated), listTables
(paginated, with format detection — Iceberg/Parquet/ORC/CSV), and
getTableSchema (columns + partition keys + location + format).

AccessDenied is silently filtered for browse paths; direct fetches
surface EntityNotFoundException explicitly. Pod's IRSA identity is
used implicitly."
```

---

## Task 7: Implement query lifecycle API endpoints

**Goal:** REST routes `POST /api/v1/query`, `GET /api/v1/query/:id/status`, `GET /api/v1/query/:id/results`, `DELETE /api/v1/query/:id`. Catalog discovery routes `GET /api/v1/catalogs`, `GET /api/v1/catalogs/:catalogId/databases`, `GET /api/v1/databases/:db/tables` (in catalog context), `GET /api/v1/tables/:catalogId/:database/:table/schema`. All routes go through auth + team isolation; no SQL pass-through.

**Files:**

Create:
- `packages/api/src/routers/api/query.ts`
- `packages/api/src/routers/api/catalog.ts`
- `packages/api/src/controllers/query.ts`
- `packages/api/src/controllers/catalog.ts`
- `packages/api/src/utils/queryClassifier.ts`     — read/write classification of SQL
- `packages/api/src/__tests__/routers/query.test.ts`
- `packages/api/src/__tests__/routers/catalog.test.ts`

Modify:
- `packages/api/src/routers/api/index.ts` — register `queryRouter`, `catalogRouter`
- `packages/api/src/api-app.ts` — `app.use('/api/v1/query', queryRouter)` and `app.use('/api/v1', catalogRouter)`
- `packages/api/package.json` — depend on `@berg/common-utils` (already there)

**Acceptance Criteria:**

- [ ] `POST /api/v1/query` accepts `{ sql, sourceId? }`, returns either full results or `{ executionId, status: 'running' }`
- [ ] `POST /api/v1/query` rejects (403) any SQL classified as write (INSERT/UPDATE/DELETE/MERGE/DDL)
- [ ] `GET /api/v1/query/:id/status` and `:id/results?nextToken=...` work
- [ ] `DELETE /api/v1/query/:id` cancels the query
- [ ] All query routes require auth and check team-isolation: if `sourceId` provided, the Source must belong to the requesting user's team
- [ ] Catalog routes return data from Glue, scoped to whatever the IAM role can see
- [ ] Cost (`scannedBytes`) included in every successful query response
- [ ] Unit tests cover auth, team isolation, write rejection, sync/async handoff, error mapping

**Verify:** `cd packages/api && yarn ci:unit src/__tests__/routers` → all pass; `make dev-int FILE=query` passes.

**Steps:**

- [ ] **Step 1: Write the SQL classifier with tests**

`packages/api/src/__tests__/utils/queryClassifier.test.ts`:

```ts
import { classifyQuery } from '@/utils/queryClassifier';

describe('classifyQuery', () => {
  it.each([
    ['SELECT * FROM events', 'read'],
    ['SELECT count(*) FROM x', 'read'],
    ['  select id from x', 'read'],
    ['/*c*/ SELECT 1', 'read'],
    ['INSERT INTO events VALUES (1)', 'write'],
    ['UPDATE events SET x=1', 'write'],
    ['DELETE FROM events', 'write'],
    ['MERGE INTO events ...', 'write'],
    ['CREATE TABLE x(...)', 'write'],
    ['DROP TABLE x', 'write'],
    ['ALTER TABLE x ...', 'write'],
    ['TRUNCATE TABLE x', 'write'],
    ['', 'read'],
  ])('classifies %s as %s', (sql, expected) => {
    expect(classifyQuery(sql)).toBe(expected);
  });

  it('treats CTE-with-INSERT as write', () => {
    const sql = "WITH x AS (SELECT 1) INSERT INTO y SELECT * FROM x";
    expect(classifyQuery(sql)).toBe('write');
  });
});
```

Run, expect FAIL.

- [ ] **Step 2: Implement `packages/api/src/utils/queryClassifier.ts`**

```ts
const WRITE_KEYWORDS = /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke)\b/i;

export function classifyQuery(sql: string): 'read' | 'write' {
  if (!sql) return 'read';
  // Strip comments / leading whitespace
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
  return WRITE_KEYWORDS.test(stripped) ? 'write' : 'read';
}
```

Run tests, verify PASS.

- [ ] **Step 3: Implement `packages/api/src/controllers/query.ts`**

```ts
import { AthenaClient } from '@berg/common-utils/dist/athena';
import * as cfg from '@/config';
import { classifyQuery } from '@/utils/queryClassifier';
import { Source } from '@/models/source';

const athena = new AthenaClient({ region: cfg.ATHENA_REGION });

export async function startQuery(opts: { sql: string; teamId: string; sourceId?: string }) {
  if (classifyQuery(opts.sql) === 'write') {
    const e: any = new Error('Write operations are not permitted in v1');
    e.code = 'forbidden_write';
    throw e;
  }

  if (opts.sourceId) {
    const source = await Source.findOne({ _id: opts.sourceId, team: opts.teamId });
    if (!source) {
      const e: any = new Error('Source not found or not accessible');
      e.code = 'source_not_found';
      throw e;
    }
    // Update lastQueriedAt; non-blocking
    Source.updateOne({ _id: source._id }, { $set: { lastQueriedAt: new Date() } }).catch(() => {});
  }

  return athena.executeSync(opts.sql, {
    workgroup: cfg.ATHENA_WORKGROUP,
    outputLocation: cfg.ATHENA_OUTPUT_LOCATION,
    region: cfg.ATHENA_REGION,
    syncTimeoutMs: cfg.ATHENA_SYNC_TIMEOUT_MS,
    resultReuseTtlMin: cfg.ATHENA_RESULT_REUSE_TTL_MIN,
  });
}

export async function getQueryStatus(executionId: string) {
  return athena.getStatus(executionId);
}

export async function getQueryResults(executionId: string, nextToken?: string) {
  return athena.getResults(executionId, nextToken);
}

export async function cancelQuery(executionId: string) {
  return athena.cancel(executionId);
}
```

- [ ] **Step 4: Implement `packages/api/src/routers/api/query.ts`**

```ts
import express from 'express';
import { z } from 'zod';
import { processRequest, validateRequest } from 'zod-express-middleware';

import { isUserAuthenticated, getNonNullUserWithTeam } from '@/middleware/auth';
import {
  startQuery, getQueryStatus, getQueryResults, cancelQuery,
} from '@/controllers/query';

const router = express.Router();
router.use(isUserAuthenticated);

router.post(
  '/',
  validateRequest({
    body: z.object({
      sql: z.string().min(1),
      sourceId: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const r = await startQuery({
        sql: req.body.sql,
        teamId: teamId.toString(),
        sourceId: req.body.sourceId,
      });
      res.json(r);
    } catch (e: any) {
      if (e.code === 'forbidden_write') return res.status(403).json({ error: e.message });
      if (e.code === 'source_not_found') return res.status(404).json({ error: e.message });
      next(e);
    }
  },
);

router.get(
  '/:id/status',
  validateRequest({ params: z.object({ id: z.string().min(1) }) }),
  async (req, res, next) => {
    try {
      res.json({ status: await getQueryStatus(req.params.id) });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/results',
  validateRequest({
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ nextToken: z.string().optional() }),
  }),
  async (req, res, next) => {
    try {
      res.json(await getQueryResults(req.params.id, req.query.nextToken));
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: z.string().min(1) }) }),
  async (req, res, next) => {
    try {
      await cancelQuery(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
```

- [ ] **Step 5: Implement `packages/api/src/controllers/catalog.ts` and `routers/api/catalog.ts`**

Controller:
```ts
import { GlueCatalogClient } from '@berg/common-utils/dist/glue';
import * as cfg from '@/config';

const glue = new GlueCatalogClient({ region: cfg.ATHENA_REGION });

export const listCatalogs = () => glue.listCatalogs();
export const listDatabases = (catalogId: string) => glue.listDatabases(catalogId);
export const listTables = (catalogId: string, database: string) => glue.listTables(catalogId, database);
export const getTableSchema = (catalogId: string, database: string, table: string) =>
  glue.getTableSchema(catalogId, database, table);
```

Router:
```ts
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { isUserAuthenticated } from '@/middleware/auth';
import {
  listCatalogs, listDatabases, listTables, getTableSchema,
} from '@/controllers/catalog';

const router = express.Router();
router.use(isUserAuthenticated);

router.get('/catalogs', async (_req, res, next) => {
  try { res.json({ catalogs: await listCatalogs() }); } catch (e) { next(e); }
});

router.get('/catalogs/:catalogId/databases', async (req, res, next) => {
  try { res.json({ databases: await listDatabases(req.params.catalogId) }); } catch (e) { next(e); }
});

router.get(
  '/catalogs/:catalogId/databases/:database/tables',
  validateRequest({
    params: z.object({ catalogId: z.string(), database: z.string() }),
  }),
  async (req, res, next) => {
    try {
      res.json({ tables: await listTables(req.params.catalogId, req.params.database) });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/catalogs/:catalogId/databases/:database/tables/:table/schema',
  validateRequest({
    params: z.object({ catalogId: z.string(), database: z.string(), table: z.string() }),
  }),
  async (req, res, next) => {
    try {
      const schema = await getTableSchema(req.params.catalogId, req.params.database, req.params.table);
      res.json(schema);
    } catch (e: any) {
      if (e.name === 'EntityNotFoundException') return res.status(404).json({ error: e.message });
      next(e);
    }
  },
);

export default router;
```

- [ ] **Step 6: Register routers**

In `packages/api/src/routers/api/index.ts`:
```ts
import queryRouter from './query';
import catalogRouter from './catalog';

export default {
  // ...existing
  queryRouter,
  catalogRouter,
};
```

In `packages/api/src/api-app.ts`, add the `app.use(...)` registrations:
```ts
app.use('/api/v1/query', routers.queryRouter);
app.use('/api/v1', routers.catalogRouter);
```

- [ ] **Step 7: Write integration test for the query route**

`packages/api/src/__tests__/routers/query.test.ts`:

```ts
import request from 'supertest';
import { mockClient } from 'aws-sdk-client-mock';
import { AthenaClient as SdkAthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from '@aws-sdk/client-athena';
import { setupTestApp, login, ObjectId } from '../testUtils'; // existing test helpers in HyperDX

const sdk = mockClient(SdkAthenaClient);
beforeEach(() => sdk.reset());

describe('POST /api/v1/query', () => {
  it('runs a SELECT and returns rows', async () => {
    const { app, agent } = await setupTestApp();
    await login(agent);
    sdk.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'e1' });
    sdk.on(GetQueryExecutionCommand).resolves({
      QueryExecution: { Status: { State: 'SUCCEEDED' }, Statistics: { DataScannedInBytes: 100 } },
    });
    sdk.on(GetQueryResultsCommand).resolves({
      ResultSet: {
        ResultSetMetadata: { ColumnInfo: [{ Name: 'n', Type: 'integer' }] },
        Rows: [
          { Data: [{ VarCharValue: 'n' }] },
          { Data: [{ VarCharValue: '5' }] },
        ],
      },
    });

    const r = await agent.post('/api/v1/query').send({ sql: 'SELECT 5' });
    expect(r.status).toBe(200);
    expect(r.body.rows).toEqual([{ n: 5 }]);
    expect(r.body.scannedBytes).toBe(100);
  });

  it('rejects writes with 403', async () => {
    const { app, agent } = await setupTestApp();
    await login(agent);
    const r = await agent.post('/api/v1/query').send({ sql: 'INSERT INTO x VALUES (1)' });
    expect(r.status).toBe(403);
  });

  it('returns 401 unauthenticated', async () => {
    const { app, agent } = await setupTestApp();
    const r = await agent.post('/api/v1/query').send({ sql: 'SELECT 1' });
    expect(r.status).toBe(401);
  });
});
```

(Note: this references existing test helpers `setupTestApp` and `login`; if they don't exist with those names, look in the existing `__tests__/` for similar helpers and adapt.)

- [ ] **Step 8: Run tests**

```bash
cd packages/api && yarn ci:unit src/__tests__/routers/query.test.ts
make dev-int FILE=query
```

Both pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): query lifecycle and catalog discovery routes

POST /api/v1/query runs Athena queries through team-isolation gate;
returns rows for fast queries or { executionId, status: running } if
sync timeout elapses. SELECT-only in v1 (write SQL → 403). GET status,
GET results (paginated), DELETE cancel.

GET /api/v1/catalogs (and nested databases/tables/:table/schema) wraps
Glue Data Catalog. AccessDenied filters silently for browse; explicit
404 for direct schema fetch on missing table.

No SQL pass-through endpoint — every query goes through the gate."
```

---

# PR3 — UI surfaces

## Task 8: Build Catalog page

**Goal:** A new `/catalog` page renders a tree of Catalog → Database → Table on the left and a detail pane on the right with breadcrumb, primary actions, and four tabs (Schema / Sample / DDL / Stats). Click "Save as Source" opens the Edit Source modal (built in Task 10); click "Open in Search" deep-links to `/search?sourceId=...` with a stub-Source if not yet saved; click "Open in SQL" deep-links to a SQL editor route.

**Files:**

Create:
- `packages/app/pages/catalog/index.tsx`
- `packages/app/pages/catalog/[catalogId]/[database]/[table].tsx`
- `packages/app/src/components/Catalog/CatalogTree.tsx`
- `packages/app/src/components/Catalog/CatalogTableDetail.tsx`
- `packages/app/src/components/Catalog/CatalogTabSchema.tsx`
- `packages/app/src/components/Catalog/CatalogTabSample.tsx`
- `packages/app/src/components/Catalog/CatalogTabDDL.tsx`
- `packages/app/src/components/Catalog/CatalogTabStats.tsx`
- `packages/app/src/hooks/useCatalogs.ts`
- `packages/app/src/hooks/useDatabases.ts`
- `packages/app/src/hooks/useTables.ts`
- `packages/app/src/hooks/useTableSchema.ts`
- `packages/app/src/__tests__/components/Catalog/CatalogTree.test.tsx`

Modify:
- `packages/app/src/components/AppNav/AppNav.tsx` — add "Catalog" link at top
- `packages/app/src/api.ts` — add catalog API hooks via TanStack Query

**Acceptance Criteria:**

- [ ] `/catalog` route renders, lists all visible catalogs from `/api/v1/catalogs`
- [ ] Expand/collapse on catalog node fetches databases via `/api/v1/catalogs/:catalogId/databases`
- [ ] Expand/collapse on database fetches tables
- [ ] Click table → right pane updates with breadcrumb and tabs
- [ ] Schema tab calls out auto-detected timestamp column (any TIMESTAMP-typed column with a name like `*time*`, `*ts*`, or `*timestamp*`; first match wins)
- [ ] Sample tab runs `SELECT * FROM ... LIMIT 50` against the selected table and shows results
- [ ] DDL tab shows generated `CREATE TABLE` statement (best-effort from Glue metadata)
- [ ] Stats tab shows row count (running `SELECT count(*)`), partition count, total size (from Glue if available)
- [ ] "Save as Source" button opens Edit Source modal (Task 10) pre-filled
- [ ] "Open in Search" navigates to `/search?catalog=...&database=...&table=...` (Task 9 reads these)
- [ ] "Open in SQL" navigates to `/sql?initial=SELECT * FROM "catalog"."database"."table" LIMIT 100`
- [ ] AppNav has "Catalog" link added

**Verify:** Manual smoke test in dev — open `/catalog`, expand a catalog, click a table, see schema and sample. Plus `cd packages/app && yarn ci:unit src/__tests__/components/Catalog/`.

**Steps:**

- [ ] **Step 1: Add catalog API hooks**

`packages/app/src/hooks/useCatalogs.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import api from '@/api';

export const useCatalogs = () =>
  useQuery({
    queryKey: ['catalogs'],
    queryFn: () => api.get('/api/v1/catalogs').then(r => r.data.catalogs as string[]),
  });
```

`useDatabases.ts`:
```ts
export const useDatabases = (catalogId: string | undefined) =>
  useQuery({
    queryKey: ['databases', catalogId],
    enabled: !!catalogId,
    queryFn: () => api.get(`/api/v1/catalogs/${encodeURIComponent(catalogId!)}/databases`).then(r => r.data.databases as string[]),
  });
```

`useTables.ts` and `useTableSchema.ts` — analogous.

- [ ] **Step 2: Implement `CatalogTree`**

A controlled tree component using Mantine's `<NavLink>` recursively. Source hierarchy is async (children loaded on expand). Top of the pane is a `<TextInput>` filter that filters across the loaded tree.

- [ ] **Step 3: Implement `CatalogTableDetail` with tabs**

Use Mantine `<Tabs>`. Each tab is a separate component file. Schema tab uses `useTableSchema()`; Sample tab uses the existing query API hook (build it via `api.post('/api/v1/query', { sql })`); DDL tab synthesizes from Glue schema; Stats runs a count query.

For the recommended timestamp column auto-detect, in `CatalogTabSchema.tsx`:
```ts
function pickRecommendedTimestamp(cols: GlueColumn[]): string | undefined {
  const ts = cols.filter(c => c.type.toLowerCase().startsWith('timestamp'));
  if (ts.length === 1) return ts[0].name;
  // Prefer columns with names containing time/ts/timestamp
  const named = ts.find(c => /time|ts|timestamp/i.test(c.name));
  return named?.name ?? ts[0]?.name;
}
```

- [ ] **Step 4: Add Catalog link to AppNav**

In `AppNav.tsx`, before the existing `<AppNavLink label="Search" />`, add:
```tsx
<AppNavLink
  label="Catalog"
  icon={<IconFolderOpen size={16} />}
  href="/catalog"
  isActive={pathname === '/catalog' || pathname.startsWith('/catalog/')}
/>
```

- [ ] **Step 5: Add the page route**

`packages/app/pages/catalog/index.tsx`:
```tsx
import dynamic from 'next/dynamic';
const CatalogPage = dynamic(() => import('@/components/Catalog/CatalogPage'), { ssr: false });
export default CatalogPage;
```

`packages/app/pages/catalog/[catalogId]/[database]/[table].tsx` — same pattern, just routes to a focused component variant.

- [ ] **Step 6: Write a smoke test for `CatalogTree`**

`packages/app/src/__tests__/components/Catalog/CatalogTree.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogTree } from '@/components/Catalog/CatalogTree';
import { server, rest } from '@/mocks/server';

beforeEach(() => server.resetHandlers());

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

it('renders catalogs from the API', async () => {
  server.use(
    rest.get('/api/v1/catalogs', (_req, res, ctx) =>
      res(ctx.json({ catalogs: ['AwsDataCatalog', 's3tablescatalog/x'] })),
    ),
  );
  render(wrap(<CatalogTree onSelectTable={jest.fn()} />));
  await waitFor(() => expect(screen.getByText('AwsDataCatalog')).toBeInTheDocument());
  expect(screen.getByText('s3tablescatalog/x')).toBeInTheDocument();
});

it('expands a catalog to show databases', async () => {
  server.use(
    rest.get('/api/v1/catalogs', (_req, res, ctx) =>
      res(ctx.json({ catalogs: ['AwsDataCatalog'] })),
    ),
    rest.get('/api/v1/catalogs/AwsDataCatalog/databases', (_req, res, ctx) =>
      res(ctx.json({ databases: ['db1', 'db2'] })),
    ),
  );
  render(wrap(<CatalogTree onSelectTable={jest.fn()} />));
  await screen.findByText('AwsDataCatalog');
  await userEvent.click(screen.getByText('AwsDataCatalog'));
  await waitFor(() => expect(screen.getByText('db1')).toBeInTheDocument());
});
```

(Uses existing MSW mock infrastructure under `packages/app/src/mocks/`; if patterns differ, mirror what's used in `DBSearchPage.test.tsx` etc.)

- [ ] **Step 7: Run tests, then manual smoke**

```bash
cd packages/app && yarn ci:unit src/__tests__/components/Catalog/
yarn dev
# Visit /catalog, expand a catalog, click a table.
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(app): Catalog page with tree, schema/sample/DDL/stats tabs

New /catalog route lets users browse Glue catalogs → databases → tables,
view schema with auto-detected timestamp column, run a 50-row sample,
inspect DDL and basic stats. Three primary actions per table: Save as
Source, Open in Search, Open in SQL.

Adds AppNav 'Catalog' link as the first nav item."
```

---

## Task 9: Generalize Search/Discover for time-optional Sources

**Goal:** `DBSearchPage` works against the new single Table source with a `timestampColumn?` field. Renders histogram + time picker only when the column is set; flat row browser otherwise. The OTel-shaped log side panel is replaced by a generic JSON row inspector.

**Files:**

Modify (all):
- `packages/app/src/DBSearchPage.tsx`
- `packages/app/src/DBSearchPageAlertModal.tsx` — delete (alerts out of v1)
- `packages/app/src/components/DBRowSidePanel.tsx` — generic JSON inspector
- `packages/app/src/components/DBRowSidePanelHeader.tsx` — drop trace/log breadcrumb
- `packages/app/src/components/DBSearchPageFilters.tsx` — facets pull values via Athena, not ClickHouse-specific introspection
- `packages/app/src/ChartUtils.tsx` — chart config no longer assumes Log/Trace/etc.
- `packages/app/src/timeQuery.ts` — handle Source without timestampColumn (skip time math)
- `packages/app/src/api.ts` — `useSearch` hook posts to `/api/v1/query` instead of ClickHouse proxy
- `packages/app/src/searchFilters.tsx` — drop OTel-shaped attribute logic

Delete:
- `packages/app/src/DBSearchPageAlertModal.tsx`
- `packages/app/src/components/AlertStatusIcon.tsx` (already deleted in Task 2 — confirm)
- `packages/app/src/components/AlertPreviewChart.tsx`

Create:
- `packages/app/src/__tests__/DBSearchPage.test.tsx` (or extend existing if present)

**Acceptance Criteria:**

- [ ] Picking a Source with `timestampColumn` set renders time picker + histogram + time-ordered results
- [ ] Picking a Source without `timestampColumn` hides the picker (shows "no time field" label) and the histogram (shows a stats line)
- [ ] Lucene search bar emits Trino SQL via the new parser (no ClickHouse-specific functions in network requests)
- [ ] Saved Search create/load/delete works
- [ ] Click a row → generic JSON side panel with full row, ARRAY/MAP/ROW types render recursively
- [ ] Cost line at the bottom shows "Athena · scanned X MB · cached" using `scannedBytes` from response
- [ ] No reference to Log/Trace/Session/Metric source kinds in the rendered UI or types
- [ ] No reference to alert UI on the page
- [ ] `make ci-unit` passes

**Verify:** Manual smoke + the new test file passes. `cd packages/app && yarn ci:unit src/__tests__/DBSearchPage.test.tsx`.

**Steps:**

- [ ] **Step 1: Delete `DBSearchPageAlertModal.tsx` and any orphan imports**

```bash
git rm packages/app/src/DBSearchPageAlertModal.tsx
grep -rn "DBSearchPageAlertModal" packages/app/src
```
Remove imports from `DBSearchPage.tsx`.

- [ ] **Step 2: Refactor `DBSearchPage.tsx` to drop source-kind branching**

The page currently switches on Source.kind (Log/Trace/Session/Metric) to render different headers, filter controls, side panels. Collapse to a single render path that:
- Reads `source.timestampColumn`. If set, render `<TimePickerInput>` and `<HistogramSparkline>`. If not, render a `<Text c='dimmed'>no time field</Text>` placeholder where the picker would be.
- Always renders `<LuceneSearchBar>`, `<SearchFilters>`, `<RowTable>`, `<DBRowSidePanel>` (now generic).

Read the existing `DBSearchPage.tsx` and remove every conditional branch on source kind. Single Source type from now on.

- [ ] **Step 3: Replace `DBRowSidePanel` with a generic JSON inspector**

Existing `DBRowSidePanel.tsx` has tabs/sections for log details, trace waterfalls, session replays. Replace with:

```tsx
import { Drawer, ScrollArea, Stack, Text } from '@mantine/core';
import { HyperJson } from '@/components/HyperJson';

export function DBRowSidePanel({
  row, opened, onClose, sourceLabel,
}: {
  row: Record<string, unknown> | null;
  opened: boolean;
  onClose: () => void;
  sourceLabel: string;
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title={<Text fw={600}>{sourceLabel}</Text>}
    >
      <ScrollArea h="calc(100vh - 80px)">
        {row ? <HyperJson value={row} /> : <Text c="dimmed">No row selected</Text>}
      </ScrollArea>
    </Drawer>
  );
}
```

`HyperJson` already exists; it handles nested ARRAY/MAP/ROW recursively.

- [ ] **Step 4: Update `useSearch` hook**

In `packages/app/src/api.ts`, replace the existing search query hook (which posts to ClickHouse proxy) with one that posts to `/api/v1/query`:

```ts
export const useSearchQuery = ({ sourceId, sql }: { sourceId: string; sql: string }) =>
  useQuery({
    queryKey: ['search', sourceId, sql],
    enabled: !!sql,
    queryFn: () => apiClient.post('/api/v1/query', { sourceId, sql }).then(r => r.data),
  });
```

- [ ] **Step 5: Update `timeQuery.ts` to handle missing timestamp column**

Read the existing module — it has helpers like `getTimeRangeWhereClause`. Wrap each in a guard:

```ts
export function getTimeRangeWhereClause(source: Source, range: { start: Date; end: Date }): string {
  if (!source.timestampColumn) return '1=1';
  // existing emit, but use Trino syntax: from_unixtime(...)
  return `"${source.timestampColumn}" BETWEEN from_unixtime(${Math.floor(range.start.getTime()/1000)}) AND from_unixtime(${Math.floor(range.end.getTime()/1000)})`;
}
```

- [ ] **Step 6: Update facet pulls in `DBSearchPageFilters.tsx`**

Filter values come from `SELECT col, count(*) FROM <table> GROUP BY col LIMIT 50`. Run via `useSearchQuery` (or a parallel `useFacetCounts` hook).

- [ ] **Step 7: Write a render test for both modes**

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DBSearchPage from '@/DBSearchPage';

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

it('renders time picker when source has timestampColumn', () => {
  const source = { id: '1', kind: 'Table', timestampColumn: 'event_time', /*...*/ };
  render(wrap(<DBSearchPage source={source} />));
  expect(screen.getByLabelText(/time range/i)).toBeInTheDocument();
});

it('renders no-time-field label when source has no timestampColumn', () => {
  const source = { id: '2', kind: 'Table', /* no timestampColumn */ };
  render(wrap(<DBSearchPage source={source} />));
  expect(screen.getByText(/no time field/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/time range/i)).toBeNull();
});
```

- [ ] **Step 8: Run tests and manual smoke**

```bash
cd packages/app && yarn ci:unit src/__tests__/DBSearchPage.test.tsx
yarn dev
# Manually save a Source with timestampColumn — run a search; verify histogram.
# Save a Source without timestampColumn — run a search; verify no histogram, stats line shown.
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(app): generalize Search/Discover for time-optional Sources

DBSearchPage drops Log/Trace/Session/Metric branching; renders against
a single Table source kind. When source.timestampColumn is set, full
time-picker + histogram UX; otherwise hides them and shows a stats
line. Side panel replaced with a generic JSON inspector that handles
nested ARRAY/MAP/ROW recursively. All queries go through /api/v1/query
emitting Trino SQL.

Removes alert UI from the page (alerts out of v1)."
```

---

## Task 10: Build Sources list and Edit Source modal

**Goal:** A `/sources/list` page renders all team Sources with per-row actions (search/SQL/edit/delete). The Edit Source modal is reused from "Save as Source" (Catalog) and "Edit" (list).

**Files:**

Create:
- `packages/app/pages/sources/list.tsx`
- `packages/app/src/components/Sources/SourcesList.tsx`
- `packages/app/src/components/Sources/EditSourceModal.tsx`
- `packages/app/src/__tests__/components/Sources/SourcesList.test.tsx`
- `packages/app/src/__tests__/components/Sources/EditSourceModal.test.tsx`

Modify:
- `packages/app/src/source.ts` — `useSources`, `useSaveSource`, `useDeleteSource` hooks
- `packages/app/src/components/AppNav/AppNav.tsx` — add "Sources" link
- `packages/api/src/routers/api/sources.ts` — accept the new Source shape on create/update (drop legacy fields)

**Acceptance Criteria:**

- [ ] `/sources/list` renders all team Sources in a table
- [ ] Filter input filters by display name and table reference
- [ ] Per-row actions: 🔍 (deep-link `/search?sourceId=:id`), ⌨ (deep-link `/sql?sourceId=:id`), ✏️ (open Edit modal), 🗑️ (confirm-delete)
- [ ] Edit modal validates: display name required, time column dropdown lists only TIMESTAMP/DATE columns from the table's schema (fetched via `/api/v1/.../schema`)
- [ ] "Save as Source" from Catalog opens the same modal pre-filled with table reference and recommended timestamp column
- [ ] AppNav has "Sources" link (after "Saved Searches")

**Verify:** Tests pass; manual smoke creates / edits / deletes a Source.

**Steps:**

- [ ] **Step 1: Update API hooks in `packages/app/src/source.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TableSource } from '@berg/common-utils/dist/types';
import api from '@/api';

export const useSources = () =>
  useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get('/api/v1/sources').then(r => r.data as TableSource[]),
  });

export const useSaveSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Omit<TableSource, 'team'>) =>
      s.id
        ? api.put(`/api/v1/sources/${s.id}`, s).then(r => r.data)
        : api.post('/api/v1/sources', s).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
};

export const useDeleteSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/sources/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
};
```

- [ ] **Step 2: Implement `SourcesList`**

A Mantine `<Table>` with rows. The "Last queried" column reads `source.lastQueriedAt` and renders relative time. Filter input does client-side filtering on `displayName` + `catalog.database.table`.

- [ ] **Step 3: Implement `EditSourceModal`**

A Mantine `<Modal>` with `<TextInput>` for display name, a read-only display of catalog/database/table (when editing) or selectable (when saving from Catalog), `<Select>` for time column populated from the schema fetch, `<TextInput>` for default sort, `<TagsInput>` for default columns. Submit calls `useSaveSource`.

The schema fetch for the time-column dropdown: `useTableSchema(catalogId, database, table)` — same hook as Task 8.

- [ ] **Step 4: Wire AppNav**

Add `<AppNavLink label="Sources" href="/sources/list" icon={<IconStar size={16} />} />` after "Saved Searches".

- [ ] **Step 5: Write tests**

Test `SourcesList` renders sources, filter narrows the list, delete opens confirm and calls API.

Test `EditSourceModal` validates required fields, populates time-column dropdown from schema, calls save on submit.

- [ ] **Step 6: Manual smoke**

Save a table from Catalog → see it in `/sources/list` → edit → delete.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): Sources list page and Edit Source modal

/sources/list shows all team Sources with name, table reference, time
column, default sort, last queried, and per-row actions. Edit modal is
reused for both 'Save as Source' (from Catalog) and 'Edit' (from list);
time-column dropdown lists only TIMESTAMP/DATE columns from the live
schema."
```

---

# PR4 — Dashboard generalization

## Task 11: Generalize Dashboard charts for any table

**Goal:** Existing dashboard UX preserved wholesale. Chart config's source picker now lists Berg Sources (single Table kind) instead of telemetry kinds. Chart SQL emit goes through the new Trino emitter. Charts requiring a time field hide the time-axis option for Sources without `timestampColumn`. Tile-level alert UI removed.

**Files:**

Modify:
- `packages/app/src/DBDashboardPage.tsx`
- `packages/app/src/DBChartPage.tsx`
- `packages/app/src/components/ChartEditor/**`
- `packages/app/src/components/DBEditTimeChartForm/**`
- `packages/app/src/components/DBTimeChart.tsx`, `DBTableChart.tsx`, `DBNumberChart.tsx`, `DBPieChart.tsx`, `DBHeatmapChart.tsx`, `DBHistogramChart.tsx`, `DBListBarChart.tsx`, `DBDeltaChart.tsx`
- `packages/common-utils/src/core/renderChartConfig.ts` — emit Trino SQL via `TrinoSchemaSerializer`
- `packages/common-utils/src/macros.ts` — drop ClickHouse-specific macros
- `packages/app/src/components/DashboardContainer.tsx` — drop alert tile rendering

Delete:
- `packages/app/src/components/alerts/` (if not already in Task 2)
- `packages/app/src/AlertScheduleFields.tsx`

**Acceptance Criteria:**

- [ ] All chart types render correctly for both time-enabled and no-time Sources
- [ ] Source picker in chart editor lists Berg Sources (no kind branching)
- [ ] No reference to ClickHouse SQL syntax in any chart's emitted SQL
- [ ] Time-series chart type is hidden in the chart-type picker for Sources without `timestampColumn`
- [ ] Dashboard create/view/edit/delete works end-to-end
- [ ] No alert UI on tile editor or tile render

**Verify:** Tests + manual smoke. Open a dashboard, edit a tile, verify Source picker, verify chart type filtering for no-time sources, save and view.

**Steps:**

- [ ] **Step 1: Update `renderChartConfig.ts` to emit Trino SQL**

Find the `renderChartConfig` function. It currently uses `CustomSchemaSQLSerializerV2` (already deleted in Task 5). Update to use `TrinoSchemaSerializer`. Pass `timestampColumn` from the Source.

- [ ] **Step 2: Update `ChartEditor` source picker**

In `packages/app/src/components/ChartEditor/`, find the source-picker component. It's currently a discriminated union (Log/Trace/Session/Metric). Collapse to a single `<Select>` of Berg Sources via `useSources`.

- [ ] **Step 3: Update chart-type filtering**

In `DBEditTimeChartForm`, when computing the chart-type options, gate `timeseries` and `histogram` on `source.timestampColumn != null`:

```ts
const availableChartTypes = useMemo(() => {
  const all = ['table', 'number', 'pie', 'bar'];
  if (source.timestampColumn) all.push('timeseries', 'histogram', 'heatmap');
  return all;
}, [source.timestampColumn]);
```

- [ ] **Step 4: Strip alert UI from tile editor**

In `DashboardContainer.tsx` and the chart editor, remove any `<AlertConfig />` blocks. Remove the `tile.config.alert` field from `Dashboard` type.

- [ ] **Step 5: Run tests**

```bash
make ci-unit
```

Update any chart-related tests. The `renderChartConfig.test.ts` in common-utils may have ClickHouse-shape assertions that need Trino-shape replacements (similar to Task 5 Step 6).

- [ ] **Step 6: Manual smoke test**

```bash
yarn dev
# Open a dashboard, edit a tile, change source to a no-time Source, verify timeseries is not in the picker.
# Change source to a time-enabled Source, verify all chart types available.
# Save dashboard, view, verify chart renders.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): generalize Dashboard charts for any Table source

Chart config no longer assumes Log/Trace/Session/Metric source kinds —
single Table source with optional timestampColumn. SQL emit goes through
TrinoSchemaSerializer. Chart-type picker hides timeseries / histogram /
heatmap options for sources without a timestampColumn.

Drops tile-level alert config (alerts out of v1)."
```

---

## Final verification

After PR4 merges, run the full check:

```bash
make ci-lint
make ci-unit
make e2e   # if Athena LocalStack is wired into E2E setup
```

Manual sanity:
1. Login as a fresh user
2. Open `/catalog`, expand a catalog, click a table, see schema and 50-row sample
3. Click "Save as Source", fill modal, save
4. Visit `/sources/list`, see the new Source
5. Click 🔍 to open in Search; run a Lucene query; see results with histogram (if time column set)
6. Save the Search; reload it
7. Open the Chart Explorer; create a chart against the Source; save to a Dashboard
8. Open the Dashboard; verify chart renders

All eight steps green = v1 ready to demo.

---

## Deferred to Phase 2 (already in spec §11)

- Write support (INSERT/UPDATE/DELETE/DDL)
- Roles enforced (admin/editor/viewer)
- Per-namespace ACL grants
- Alerts
- Scheduled queries
- Cost guards beyond workgroup-level scan limits
- Engine alternates (Trino-on-EMR, DuckDB)
- DynamoDB metadata store

Each gets its own spec → plan → implementation cycle.
