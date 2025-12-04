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

- **Routers**: `packages/api/src/routers/` - Domain-specific API routes
- **Controllers**: `packages/api/src/controllers/` - Business logic separated from routes
- **Middleware**: Authentication, CORS, error handling
- **Services**: Reusable business logic (e.g., `agentService`)

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

