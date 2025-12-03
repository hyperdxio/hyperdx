# Service Readiness & Coverage Engine

This document tracks the implementation of the "Service Readiness & Coverage" feature, which audits services to ensure they have adequate monitoring, telemetry, SLOs, and contextual data.

## Roadmap & Checklist

### Phase 1: Service Registry (Backend Foundation)
- [x] **Create Service Model** (`packages/api/src/models/service.ts`)
    - [x] Define Schema: `name`, `team`, `description`, `owner`, `tier`, `runbookUrl`, `repoUrl`, `lastSeenAt`
    - [x] Add unique index on `{ team: 1, name: 1 }`
- [x] **Service Discovery Task** (`packages/api/src/tasks/discoverServices.ts`)
    - [x] Implement ClickHouse query to find distinct `service.name` (logs & traces)
    - [x] Implement upsert logic to populate/update `Service` collection
    - [x] Schedule task in `packages/api/src/tasks/index.ts`
- [x] **API Endpoints** (`packages/api/src/routers/api/services.ts`)
    - [x] `GET /services` - List services with metadata
    - [x] `PATCH /services/:name` - Update metadata (owner, runbook, etc.)

### Phase 2: Metadata Enrichment (Frontend)
- [x] **Service Settings UI**
    - [x] Create `ServiceSettingsModal` or Page
    - [x] Allow editing Owner, Tier, Runbook URL, Repo URL
- [x] **Service List Update**
    - [x] Update Services Dashboard to use the new `GET /services` endpoint
    - [x] Display Owner and Tier columns

### Phase 3: The Readiness Engine (Checks & Scoring)
- [x] **Readiness Check Infrastructure**
    - [x] Create `ServiceCheck` model (to store results)
    - [x] Define `Check` interface and base classes
- [x] **Implement Checks**
    - [x] **Telemetry:** Detect if traces/logs are being received
    - [x] **SLO:** Check if >= 1 SLO exists for the service
    - [x] **Monitors:** (Deferred - focusing on metadata/SLO for now)
    - [x] **Metadata:** Check for Runbook URL and Owner assignment
- [x] **Scoring Logic**
    - [x] Calculate Bronze/Silver/Gold tiers based on passing checks
    - [x] Create `runReadinessChecks` task to execute nightly

### Phase 4: Visualization & Reporting
- [x] **Readiness Scorecard Component**
    - [x] Visual indicator of score (e.g., Progress ring or Badge)
    - [x] Drill-down view showing passing/failing checks
    - [x] "Fix It" actions (links to create SLO/Alert)
- [ ] **Notifications (Optional)**
    - [ ] Periodic reports to Slack/Email about service maturity
