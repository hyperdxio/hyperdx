# HyperDX Development Guide

## What is HyperDX?

HyperDX is an observability platform that helps engineers search, visualize, and
monitor logs, metrics, traces, and session replays. It's built on ClickHouse for
blazing-fast queries and supports OpenTelemetry natively.

**Core value**: Unified observability with ClickHouse performance,
schema-agnostic design, and correlation across all telemetry types in one place.

## Architecture (WHAT)

This is a **monorepo** with three main packages:

- `packages/app` - Next.js frontend (TypeScript, Mantine UI, TanStack Query)
- `packages/api` - Express backend (Node.js 22+, MongoDB for metadata,
  ClickHouse for telemetry)
- `packages/common-utils` - Shared TypeScript utilities for query parsing and
  validation

**Data flow**: Apps → OpenTelemetry Collector → ClickHouse (telemetry data) /
MongoDB (configuration/metadata)

## Development Setup (HOW)

```bash
yarn setup          # Install dependencies
yarn dev            # Start full stack (Docker + local services)
```

The project uses **Yarn 4.5.1** workspaces. Docker Compose manages ClickHouse,
MongoDB, and the OTel Collector.

## Working on the Codebase (HOW)

**Before starting a task**, read relevant documentation from the `agent_docs/`
directory:

- `agent_docs/architecture.md` - Detailed architecture patterns and data models
- `agent_docs/tech_stack.md` - Technology stack details and component patterns
- `agent_docs/development.md` - Development workflows, testing, and common tasks
- `agent_docs/code_style.md` - Code patterns and best practices (read only when
  actively coding)

**Tools handle formatting and linting automatically** via pre-commit hooks.
Focus on implementation; don't manually format code.

## Key Principles

1. **Multi-tenancy**: All data is scoped to `Team` - ensure proper filtering
2. **Type safety**: Use TypeScript strictly; Zod schemas for validation
3. **Existing patterns**: Follow established patterns in the codebase - explore
   similar files before implementing
4. **Component size**: Keep files under 300 lines; break down large components
5. **UI Components**: Use custom Button/ActionIcon variants (`primary`,
   `secondary`, `danger`) - see `agent_docs/code_style.md` for required patterns
6. **Testing**: Tests live in `__tests__/` directories; use Jest for
   unit/integration tests

## Running Tests

Each package has different test commands available:

**packages/app** (unit tests only):

```bash
cd packages/app
yarn ci:unit           # Run unit tests
yarn dev:unit          # Watch mode for unit tests
yarn test:e2e          # Run end-to-end tests
yarn test:e2e:ci       # Run end-to-end tests in CI
```

**packages/api** (integration tests only):

```bash
docker compose -f ./docker-compose.ci.yml up -d # Start the integration test docker services
cd packages/api
yarn ci:int            # Run integration tests
yarn dev:int           # Watch mode for integration tests
cd ../.. && docker compose -f ./docker-compose.ci.yml down # Stop the integration test docker services
```

**packages/common-utils** (both unit and integration tests):

```bash
cd packages/common-utils
yarn ci:unit           # Run unit tests
yarn dev:unit          # Watch mode for unit tests
yarn ci:int            # Run integration tests
yarn dev:int           # Watch mode for integration tests
```

To run a specific test file or pattern:

```bash
yarn ci:unit <path/to/test.ts>                           # Run specific test file
yarn ci:unit --testNamePattern="test name pattern"       # Run tests matching pattern
```

## Important Context

- **Authentication**: Passport.js with team-based access control
- **State management**: Jotai (client), TanStack Query (server), URL params
  (filters)
- **UI library**: Mantine components are the standard (not custom UI)
- **Database patterns**: MongoDB for metadata with Mongoose, ClickHouse for
  telemetry queries

---

_Need more details? Check the `agent_docs/` directory or ask which documentation
to read._
