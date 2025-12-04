# HyperDX Developer Guide

This document provides comprehensive information for developers working on the HyperDX codebase. For user-facing documentation, see [README.md](./README.md). For codebase critiques and improvement suggestions, see [CODEBASE_REVIEW.md](./CODEBASE_REVIEW.md).

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Database Management](#database-management)
- [API Documentation](#api-documentation)
- [Common Tasks](#common-tasks)
- [Troubleshooting](#troubleshooting)

## Architecture Overview

HyperDX is a full-stack observability platform built as a monorepo with the following components:

### Core Services

1. **Frontend (Next.js App)**
   - Location: `packages/app/`
   - Port: 3000 (dev), 8080 (prod)
   - Features: Search UI, dashboards, alerts, incidents, SLOs

2. **Backend API (Express.js)**
   - Location: `packages/api/`
   - Port: 8000 (dev), 8080 (prod)
   - Features: REST API, authentication, scheduled tasks

3. **OpenTelemetry Collector**
   - Location: `docker/otel-collector/`
   - Ports: 4317 (gRPC), 4318 (HTTP)
   - Features: Receives telemetry data, forwards to ClickHouse

4. **ClickHouse Database**
   - Location: `docker/clickhouse/`
   - Port: 8123 (HTTP), 9000 (Native)
   - Purpose: Stores logs, traces, metrics, sessions

5. **MongoDB Database**
   - Location: Docker container
   - Port: 27017
   - Purpose: Stores metadata (users, teams, alerts, dashboards, incidents)

### Data Flow

```
Application → OpenTelemetry SDK → OTel Collector → ClickHouse
                                                      ↓
User Browser → Next.js App → Express API → ClickHouse (queries)
                              ↓
                           MongoDB (metadata)
```

## Project Structure

```
hyperdx-fork/
├── packages/
│   ├── api/                 # Backend Express.js API
│   │   ├── src/
│   │   │   ├── controllers/ # Business logic
│   │   │   ├── models/      # Mongoose models
│   │   │   ├── routers/     # Express routes
│   │   │   ├── tasks/       # Scheduled tasks (alerts, SLOs, etc.)
│   │   │   ├── utils/       # Utility functions
│   │   │   └── middleware/  # Express middleware
│   │   └── migrations/      # Database migrations
│   │
│   ├── app/                 # Frontend Next.js application
│   │   ├── pages/           # Next.js pages/routes
│   │   ├── src/
│   │   │   ├── components/  # React components
│   │   │   ├── hooks/       # React hooks
│   │   │   ├── utils/       # Utility functions
│   │   │   └── types.ts     # TypeScript types
│   │   └── tests/           # E2E tests (Playwright)
│   │
│   └── common-utils/        # Shared utilities
│       ├── src/
│       │   ├── clickhouse/  # ClickHouse client
│       │   ├── core/        # Core utilities
│       │   └── types.ts     # Shared types
│
├── docker/                  # Docker configurations
│   ├── clickhouse/          # ClickHouse setup
│   ├── hyperdx/             # Main app Dockerfile
│   └── otel-collector/      # OTel collector config
│
└── docker-compose.yml       # Production compose file
```

## Development Setup

### Prerequisites

- **Node.js**: >= 22.16.0
- **Yarn**: v4.5.1 (specified in package.json)
- **Docker**: For running ClickHouse and MongoDB
- **Git**: For version control

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hyperdx-fork
   ```

2. **Install dependencies**
   ```bash
   yarn setup
   # This runs: yarn install && husky install
   ```

3. **Set up environment variables**
   ```bash
   # Copy example env files (if they exist)
   cp packages/api/.env.development.example packages/api/.env.development
   cp packages/app/.env.development.example packages/app/.env.development
   ```

4. **Start development environment**
   ```bash
   yarn dev
   # This will:
   # - Start Docker containers (ClickHouse, MongoDB, OTel Collector)
   # - Start API server on port 8000
   # - Start Next.js app on port 3000
   # - Start alert checker task
   ```

### Development URLs

- **Frontend**: http://localhost:3000
- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/api-docs (if enabled)
- **ClickHouse**: http://localhost:8123
- **MongoDB**: mongodb://localhost:27017

### Local Development Mode (No Auth)

For local development without authentication:

```bash
yarn dev:local
# Sets IS_LOCAL_APP_MODE='DANGEROUSLY_is_local_app_mode💀'
# ⚠️ WARNING: Never use this in production!
```

## Key Features

### 1. Log Search & Analysis
- Full-text search with syntax highlighting
- Property-based filtering (`level:error`, `service:api`)
- Time-range queries
- Live tail functionality
- Pattern detection

### 2. Trace Visualization
- Distributed tracing with waterfall charts
- Service map visualization
- Trace-to-log correlation
- Span analysis

### 3. Incident Management
- Create incidents from alerts or manually
- Status tracking (Open, Investigating, Resolved, Closed)
- Severity levels (Low, Medium, High, Critical)
- Timeline of events
- Comments and resolution notes
- Alert-to-incident linking

### 4. Alerting
- Configurable alert rules
- Multiple notification channels (Slack, webhooks)
- Alert history tracking
- Alert-to-incident conversion

### 5. SLO Monitoring
- Service Level Objective tracking
- Error budget monitoring
- SLO violation alerts

### 6. Dashboards
- Customizable dashboards
- Multiple chart types
- Time-series visualization
- Dashboard filters

### 7. Uptime Monitoring
- HTTP endpoint monitoring
- Health check tracking
- Uptime history

## Technology Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **UI Library**: Mantine UI 7
- **State Management**: 
  - TanStack Query (server state)
  - Jotai (client state)
- **Charts**: Recharts, uPlot
- **Code Editor**: CodeMirror
- **Styling**: SCSS modules, CSS-in-JS

### Backend
- **Runtime**: Node.js 22+
- **Framework**: Express.js
- **Database**: 
  - MongoDB (via Mongoose)
  - ClickHouse (via custom client)
- **Authentication**: Passport.js (local strategy)
- **Task Scheduling**: node-cron
- **Validation**: Zod

### Infrastructure
- **Containerization**: Docker, Docker Compose
- **Monorepo**: Nx workspace
- **Package Manager**: Yarn 4
- **Language**: TypeScript 5.9

## Development Workflow

### Running Individual Services

```bash
# API only
cd packages/api
yarn dev

# Frontend only (requires API running)
cd packages/app
yarn dev:local

# Common utils (watch mode)
cd packages/common-utils
yarn dev
```

### Code Quality

```bash
# Lint all packages
yarn lint

# Lint and fix
yarn dev-lint

# Type check
cd packages/api && yarn tsc --noEmit
cd packages/app && yarn tsc --noEmit
```

### Building

```bash
# Build all packages
yarn ci-build

# Build individual package
cd packages/api && yarn build
cd packages/app && yarn build
```

## Testing

### Unit Tests

```bash
# Run all unit tests
yarn dev-unit

# Run tests for specific package
cd packages/api && yarn dev:unit
cd packages/app && yarn dev:unit
```

### Integration Tests

```bash
# Run all integration tests
make dev-int

# Run specific test file
make dev-int FILE=checkAlerts
```

### E2E Tests

```bash
# Run Playwright tests
cd packages/app
yarn test:e2e

# Run with UI
yarn test:e2e:ui

# Debug mode
yarn test:e2e:debug
```

## Database Management

### MongoDB Migrations

```bash
# Create new migration
cd packages/api
yarn dev:migrate-db-create <migration-name>

# Run migrations
yarn dev:migrate-db

# Or use Makefile
make dev-migrate-db
```

### ClickHouse Migrations

```bash
# Create new migration
cd packages/api
yarn dev:migrate-ch-create

# Run migrations
yarn dev:migrate-ch
```

### Database Reset (Development)

```bash
# Stop containers
docker compose -f docker-compose.dev.yml down

# Remove volumes
rm -rf .volumes/

# Restart
docker compose -f docker-compose.dev.yml up -d
```

## API Documentation

### OpenAPI/Swagger

The API includes OpenAPI documentation. To generate/update:

```bash
cd packages/api
yarn docgen
# Updates openapi.json
```

View API docs at: http://localhost:8000/api-docs (if enabled)

### API Structure

```
/api/
  ├── /alerts          # Alert management
  ├── /incidents       # Incident management
  ├── /dashboards      # Dashboard CRUD
  ├── /sources         # Data source configuration
  ├── /connections     # ClickHouse connections
  ├── /saved-search    # Saved searches
  ├── /slos            # SLO management
  ├── /services        # Service discovery
  ├── /uptime-monitors # Uptime monitoring
  ├── /team            # Team management
  └── /me              # Current user info

/external-api/v2/      # External API (API key auth)
  ├── /alerts
  ├── /charts
  └── /dashboards
```

## Common Tasks

### Adding a New Feature

1. **Create feature branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Implement changes**
   - Add models in `packages/api/src/models/`
   - Add controllers in `packages/api/src/controllers/`
   - Add routes in `packages/api/src/routers/api/`
   - Add UI components in `packages/app/src/components/`
   - Add pages in `packages/app/pages/`

3. **Add tests**
   - Unit tests for business logic
   - Integration tests for API endpoints
   - E2E tests for user flows

4. **Update documentation**
   - Update API docs if needed
   - Add JSDoc comments
   - Update this README if needed

5. **Create PR**
   - Ensure all tests pass
   - Get code review
   - Merge to `develop` or `main`

### Adding a New Scheduled Task

1. **Create task file**
   ```typescript
   // packages/api/src/tasks/myTask.ts
   import cron from 'cron';
   import logger from '@/utils/logger';

   export const myTask = async () => {
     logger.info('Running my task');
     // Task logic
   };
   ```

2. **Register in index**
   ```typescript
   // packages/api/src/tasks/index.ts
   import { myTask } from './myTask';
   
   // Register cron job
   ```

3. **Add to package.json scripts** (if needed)
   ```json
   "my-task": "nx run @hyperdx/api:dev-task my-task"
   ```

### Adding a New Database Model

1. **Create model**
   ```typescript
   // packages/api/src/models/myModel.ts
   import mongoose from 'mongoose';

   export interface IMyModel {
     name: string;
     // ... other fields
   }

   const MyModelSchema = new Schema<IMyModel>({
     name: { type: String, required: true },
   });

   export default mongoose.model<IMyModel>('MyModel', MyModelSchema);
   ```

2. **Export from index**
   ```typescript
   // packages/api/src/models/index.ts
   export { default as MyModel } from './myModel';
   ```

3. **Create migration** (if needed)
   ```bash
   yarn dev:migrate-db-create add-my-model
   ```

## Troubleshooting

### Port Already in Use

```bash
# Find process using port
lsof -i :8000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Docker Issues

```bash
# Reset Docker containers
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
```

### Database Connection Issues

```bash
# Check MongoDB connection
docker exec -it <mongo-container> mongosh

# Check ClickHouse connection
curl http://localhost:8123
```

### TypeScript Errors

```bash
# Clean and rebuild
cd packages/api && rm -rf build && yarn build
cd packages/app && rm -rf .next && yarn build
```

### Module Resolution Issues

```bash
# Clear node_modules and reinstall
rm -rf node_modules packages/*/node_modules
yarn install
```

## Code Style Guidelines

### TypeScript

- Use strict mode
- Prefer interfaces over types for object shapes
- Use `const` assertions where appropriate
- Avoid `any` - use `unknown` if type is truly unknown

### React/Next.js

- Use functional components with hooks
- Prefer server components where possible (Next.js 14)
- Use TanStack Query for server state
- Keep components small and focused

### Express

- Use async/await, not callbacks
- Use middleware for cross-cutting concerns
- Validate input with Zod
- Return consistent error formats

### Error Handling

- Use custom error classes from `@/utils/errors`
- Log errors with context
- Don't expose internal errors to clients
- Include request IDs in error responses

## Security Considerations

⚠️ **Important**: See [CODEBASE_REVIEW.md](./CODEBASE_REVIEW.md) for security recommendations.

### Before Production

1. Set `EXPRESS_SESSION_SECRET` to a strong random value
2. Enable HTTPS (set `secure: true` for cookies)
3. Disable `IS_LOCAL_APP_MODE`
4. Review and restrict CORS settings
5. Implement rate limiting on auth endpoints
6. Rotate API keys regularly
7. Enable MongoDB authentication
8. Secure ClickHouse with proper users/passwords

## Performance Tips

1. **Database Queries**
   - Use indexes appropriately
   - Limit result sets
   - Use pagination for large datasets

2. **Frontend**
   - Use React.memo for expensive components
   - Implement virtual scrolling for large lists
   - Code split routes

3. **API**
   - Cache frequently accessed data
   - Use connection pooling
   - Implement request timeouts

## Getting Help

- **Discord**: [Join our Discord](https://hyperdx.io/discord)
- **Issues**: [GitHub Issues](https://github.com/hyperdxio/hyperdx/issues)
- **Documentation**: [ClickStack Docs](https://clickhouse.com/docs/use-cases/observability/clickstack/overview)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed contribution guidelines.

## License

MIT License - see [LICENSE](./LICENSE) file.

---

**Last Updated**: 2024
**Maintainers**: HyperDX Team

