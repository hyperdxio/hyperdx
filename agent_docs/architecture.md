# HyperDX Architecture

## Core Services

- **HyperDX UI (`packages/app`)**: Next.js frontend serving the user interface
- **HyperDX API (`packages/api`)**: Node.js/Express backend handling queries and business logic
- **OpenTelemetry Collector**: Receives and processes telemetry data
- **ClickHouse**: Primary data store for all telemetry (logs, metrics, traces)
- **MongoDB**: Metadata storage (users, dashboards, alerts, saved searches)

## Data Flow

1. Applications send telemetry via OpenTelemetry → OTel Collector
2. OTel Collector processes and forwards data → ClickHouse
3. Users interact with UI → API queries ClickHouse
4. Configuration/metadata stored in MongoDB

## Key MongoDB Models

All models follow consistent patterns with:
- Team-based multi-tenancy (most entities belong to a `team`)
- ObjectId references between related entities
- Timestamps for audit trails
- Zod schema validation

**Key Models** (see `packages/api/src/models/`):
- `Team`: Multi-tenant organization unit
- `User`: Team members with authentication
- `Source`: ClickHouse data source configuration
- `Connection`: Database connection settings
- `SavedSearch`: Saved queries and filters
- `Dashboard`: Custom dashboard configurations
- `Alert`: Monitoring alerts with thresholds

## Frontend Architecture

- **Pages**: `packages/app/pages/` (Next.js routing)
- **Components**: `packages/app/src/` (reusable components)
- **API communication**: Custom hooks wrapping TanStack Query
- **State**: See tech_stack.md for state management details

## Backend Architecture

The API package (`packages/api`) hosts several distinct applications, each with
its own routing, authentication, and rate limiting:

### Internal API (`src/routers/api/`)

The primary API consumed by the web frontend (`packages/app`). Uses session-based
authentication (Passport.js). Follows a standard layered structure:

- **Routers**: `src/routers/api/` - Domain-specific API routes
- **Controllers**: `src/controllers/` - Business logic separated from routes
- **Middleware**: `src/middleware/` - Authentication, CORS, error handling
- **Services**: `src/services/` - Reusable business logic (e.g., `agentService`)

### External API v2 (`src/routers/external-api/v2/`)

Public REST API for programmatic access. Authenticated via Personal API Access
Key (`validateUserAccessKey` middleware), rate-limited to 100 req/min.

- **Routes**: `alerts.ts`, `charts.ts`, `dashboards.ts`, `sources.ts`,
  `webhooks.ts`
- **OpenAPI spec**: `packages/api/openapi.json` (auto-generated via
  `yarn docgen`, linted via `yarn lint:openapi` using Spectral)
- **Tests**: `src/routers/external-api/__tests__/`

When adding or modifying external API endpoints, run `yarn docgen` to regenerate
the OpenAPI spec and `yarn lint:openapi` to validate it.

### MCP Server (`src/mcp/`)

[Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI
assistants query observability data and manage dashboards. Exposed as a stateless
Streamable HTTP endpoint at `/api/mcp`, authenticated via Personal API Access
Key, rate-limited to 600 req/min.

- **Entry**: `app.ts` (Express middleware), `mcpServer.ts` (server factory)
- **Tools**: `tools/alerts/`, `tools/dashboards/`, `tools/query/`,
  `tools/savedSearches/` - each directory contains tool definitions and handlers
- **Prompts**: `prompts/dashboards/` - context prompts for AI assistants
- **Tests**: `src/mcp/__tests__/` (alerts, dashboards, query, savedSearches,
  tracing)
- **Dev/debug**: `yarn dev:mcp` launches the MCP Inspector for interactive
  testing

See `MCP.md` in the repo root for user-facing setup instructions.

### OpAMP Server (`src/opamp/`)

HTTP-based [OpAMP](https://github.com/open-telemetry/opamp-spec) server that
serves configurations to supervised OpenTelemetry Collectors. The supervisor
pings `/v1/opamp` with status, and the server returns updated config when needed.

- **Entry**: `app.ts` (Express sub-app)
- **Controller**: `controllers/opampController.ts` - config derivation logic
- **Service**: `services/agentService.ts` - agent management
- **Model**: `models/agent.ts` - agent state persistence
- **Proto**: `proto/` - Protocol Buffer definitions for OpAMP and anyvalue

Config is derived from the team document with the ingestion API key.

### Background Tasks (`src/tasks/`)

Cron-driven tasks that run outside the request/response cycle. In development,
tasks run via `yarn dev-task`; in production, they are triggered externally.

- `checkAlerts/` - Alert evaluation (runs every minute in dev)
- `provisionDashboards/` - Dashboard provisioning from config files
- `usageStats.ts` - Usage statistics collection
- `pingPongTask.ts` - Health check task
- `metrics.ts` - Task execution metrics (duration, success/failure counters)

Note: Background tasks do **not** run in Vercel preview deployments (see
`agent_docs/development.md` for details).

## Data & Query Patterns

### ClickHouse Integration
- **Query building**: Use `common-utils` for safe query construction
- **Schema flexibility**: Support for various telemetry schemas via `Source` configuration

### MongoDB Patterns
- **Multi-tenancy**: All queries filtered by team context
- **Relationships**: Use ObjectId references with proper population
- **Indexing**: Strategic indexes for query performance
- **Migrations**: Versioned migrations for schema changes (see `packages/api/migrations/`)

## Security Requirements

- **Server-side validation**: Always validate and sanitize on the backend
- **Team isolation**: All data access must filter by team context
- **API authentication**: Use authentication middleware on protected routes
- **Secrets**: Never commit secrets; use `.env` files

