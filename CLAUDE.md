# HyperDX Claude Agent Guide

This guide helps Claude AI agents understand and work effectively with the
HyperDX codebase.

## 🏗️ Project Overview

HyperDX is an observability platform built on ClickHouse that helps engineers
search, visualize, and monitor logs, metrics, traces, and session replays. It's
designed as an alternative to tools like Kibana but optimized for ClickHouse's
performance characteristics.

**Core Value Proposition:**

- Unified observability: correlate logs, metrics, traces, and session replays in
  one place
- ClickHouse-powered: blazing fast searches and visualizations
- OpenTelemetry native: works out of the box with OTEL instrumentation
- Schema agnostic: works on top of existing ClickHouse schemas

## 📁 Architecture Overview

HyperDX follows a microservices architecture with clear separation between
components:

### Core Services

- **HyperDX UI (`packages/app`)**: Next.js frontend serving the user interface
- **HyperDX API (`packages/api`)**: Node.js/Express backend handling queries and
  business logic
- **OpenTelemetry Collector**: Receives and processes telemetry data
- **ClickHouse**: Primary data store for all telemetry (logs, metrics, traces)
- **MongoDB**: Metadata storage (users, dashboards, alerts, saved searches)

### Data Flow

1. Applications send telemetry via OpenTelemetry → OTel Collector
2. OTel Collector processes and forwards data → ClickHouse
3. Users interact with UI → API queries ClickHouse
4. Configuration/metadata stored in MongoDB

## 🛠️ Technology Stack

### Frontend (`packages/app`)

- **Framework**: Next.js 14 with TypeScript
- **UI Components**: Mantine UI library + React Bootstrap
- **State Management**: Jotai for global state, TanStack Query for server state
- **Charts/Visualization**: Recharts, uPlot
- **Code Editor**: CodeMirror (for SQL/JSON editing)
- **Styling**: SCSS + CSS Modules

### Backend (`packages/api`)

- **Runtime**: Node.js 22+ with TypeScript
- **Framework**: Express.js
- **Database**:
  - ClickHouse (primary telemetry data)
  - MongoDB (metadata via Mongoose)
- **Authentication**: Passport.js with local strategy
- **Validation**: Zod schemas
- **OpenTelemetry**: Self-instrumented with `@hyperdx/node-opentelemetry`

### Common Utilities (`packages/common-utils`)

- Shared TypeScript utilities for query parsing, ClickHouse operations
- Zod schemas for data validation
- SQL formatting and query building helpers

## 🏛️ Key Architectural Patterns

### Database Models (MongoDB)

All models follow consistent patterns with:

- Team-based multi-tenancy (most entities belong to a `team`)
- ObjectId references between related entities
- Timestamps for audit trails
- Zod schema validation

**Key Models:**

- `Team`: Multi-tenant organization unit
- `User`: Team members with authentication
- `Source`: ClickHouse data source configuration
- `Connection`: Database connection settings
- `SavedSearch`: Saved queries and filters
- `Dashboard`: Custom dashboard configurations
- `Alert`: Monitoring alerts with thresholds

### Frontend Architecture

- **Page-level components**: Located in `pages/` (Next.js routing)
- **Reusable components**: Located in `src/` directory
- **State management**:
  - Server state via TanStack Query
  - Client state via Jotai atoms
  - URL state via query parameters
- **API communication**: Custom hooks wrapping TanStack Query

### Backend Architecture

- **Router-based organization**: Separate routers for different API domains
- **Middleware stack**: Authentication, CORS, error handling
- **Controller pattern**: Business logic separated from route handlers
- **Service layer**: Reusable business logic (e.g., `agentService`)

## 🔧 Development Environment

### Setup Commands

```bash
# Install dependencies and setup hooks
yarn setup

# Start full development stack (Docker + local services)
yarn dev
```

### Key Development Scripts

- `yarn app:dev`: Start API, frontend, alerts task, and common-utils in watch
  mode
- `yarn lint`: Run linting across all packages
- `yarn dev:int`: Run integration tests in watch mode
- `yarn dev:unit`: Run unit tests in watch mode (per package)

### ⚠️ BEFORE COMMITTING - Run Linting Commands

**Claude AI agents must run these commands before any commit:**

```bash
# 1. Fix linting issues in modified packages
cd packages/app && yarn run lint:fix
cd packages/api && yarn run lint:fix
cd packages/common-utils && yarn lint:fix

# 2. Check for any remaining linting issues from the main directory
yarn run lint
```

**If linting issues remain after running lint:fix**: Some linting errors cannot
be automatically fixed and require manual intervention. If `yarn run lint` still
shows errors:

1. Read the linting error messages carefully to understand the issue
2. Manually fix the reported issues in the affected files
3. Re-run `yarn run lint` to verify all issues are resolved
4. Only commit once all linting errors are fixed

**Why this is necessary**: While the project has pre-commit hooks (`lint-staged`
with Husky) that automatically fix linting issues on commit, Claude AI agents do
not trigger these hooks. Therefore, you must manually run the lint:fix commands
before committing.

### Environment Configuration

- `.env.development`: Development environment variables
- Docker Compose manages ClickHouse, MongoDB, OTel Collector
- Hot reload enabled for all services in development

## 📝 Code Style & Patterns

### TypeScript Guidelines

- **Strict typing**: Avoid `any` type assertions (use proper typing instead)
- **Zod validation**: Use Zod schemas for runtime validation
- **Interface definitions**: Clear interfaces for all data structures
- **Error handling**: Proper error boundaries and serialization

### Component Patterns

- **Functional components**: Use React hooks over class components
- **Custom hooks**: Extract reusable logic into custom hooks
- **Props interfaces**: Define clear TypeScript interfaces for component props
- **File organization**: Keep files under 300 lines, break down large components

### UI Components & Styling

**Prefer Mantine UI**: Use Mantine components as the primary UI library:

```tsx
// ✅ Good - Use Mantine components
import { Button, TextInput, Modal, Select } from '@mantine/core';

// ✅ Good - Mantine hooks for common functionality
import { useDisclosure, useForm } from '@mantine/hooks';
```

**Component Hierarchy**:

1. **First choice**: Mantine components (`@mantine/core`, `@mantine/dates`,
   etc.)
2. **Second choice**: Custom components built on Mantine primitives
3. **Last resort**: React Bootstrap or custom CSS (only when Mantine doesn't
   provide the functionality)

**Styling Approach**:

- Use Mantine's built-in styling system and theme
- SCSS modules for component-specific styles when needed
- Avoid inline styles unless absolutely necessary
- Leverage Mantine's responsive design utilities

### API Patterns

- **RESTful design**: Clear HTTP methods and resource-based URLs
- **Middleware composition**: Reusable middleware for auth, validation, etc.
- **Error handling**: Consistent error response format
- **Input validation**: Zod schemas for request validation

## 🧪 Testing Strategy

### Testing Tools

- **Unit Tests**: Jest with TypeScript support
- **Integration Tests**: Jest with database fixtures
- **Frontend Testing**: React Testing Library + Jest
- **E2E Testing**: Custom smoke tests with BATS

### Testing Patterns

- **TDD Approach**: Write tests before implementation for new features
- **Test organization**: Tests co-located with source files in `__tests__`
  directories
- **Mocking**: MSW for API mocking in frontend tests
- **Database testing**: Isolated test databases with fixtures

### CI Testing

For integration testing in CI environments:

```bash
# Start CI testing stack (ClickHouse, MongoDB, etc.)
docker compose -p int -f ./docker-compose.ci.yml up -d

# Run integration tests
yarn dev:int
```

**CI Testing Notes:**

- Uses separate Docker Compose configuration optimized for CI
- Isolated test environment with `-p int` project name
- Includes all necessary services (ClickHouse, MongoDB, OTel Collector)
- Tests run against real database instances for accurate integration testing

## 🗄️ Data & Query Patterns

### ClickHouse Integration

- **Query building**: Use `common-utils` for safe query construction
- **Schema flexibility**: Support for various telemetry schemas via `Source`
  configuration

### MongoDB Patterns

- **Multi-tenancy**: All queries filtered by team context
- **Relationships**: Use ObjectId references with proper population
- **Indexing**: Strategic indexes for query performance
- **Migrations**: Versioned migrations for schema changes

## 🚀 Common Development Tasks

### Adding New Features

1. **API First**: Define API endpoints and data models
2. **Database Models**: Create/update Mongoose schemas and ClickHouse queries
3. **Frontend Integration**: Build UI components and integrate with API
4. **Testing**: Add unit and integration tests
5. **Documentation**: Update relevant docs

### Performance Considerations

- **Frontend rendering**: Use virtualization for large datasets
- **API responses**: Implement pagination and caching where appropriate
- **Bundle size**: Monitor and optimize JavaScript bundle sizes

## 🔍 Key Files & Directories

### Configuration

- `packages/api/src/config.ts`: API configuration and environment variables
- `packages/app/next.config.js`: Next.js configuration
- `docker-compose.dev.yml`: Development environment setup

### Core Business Logic

- `packages/api/src/models/`: MongoDB data models
- `packages/api/src/routers/`: API route definitions
- `packages/api/src/controllers/`: Business logic controllers
- `packages/common-utils/src/`: Shared utilities and query builders

### Frontend Architecture

- `packages/app/pages/`: Next.js pages and routing
- `packages/app/src/`: Reusable components and utilities
- `packages/app/src/useUserPreferences.tsx`: Global user state management

## 🚨 Common Pitfalls & Guidelines

### Security

- **Server-side validation**: Always validate and sanitize on the backend
- **Team isolation**: Ensure proper team-based access control
- **API authentication**: Use proper authentication middleware
- **Environment variables**: Never commit secrets, use `.env` files

### Performance

- **React rendering**: Use proper keys and memoization for large lists
- **API pagination**: Implement cursor-based pagination for large datasets

### Code Quality

- **Component responsibility**: Single responsibility principle
- **Error boundaries**: Proper error handling at component boundaries
- **Type safety**: Prefer type-safe approaches over runtime checks

## 🔗 Useful Resources

- **OpenTelemetry Docs**: Understanding telemetry data structures
- **ClickHouse Docs**: Query optimization and schema design
- **Mantine UI**: Component library documentation
- **TanStack Query**: Server state management patterns

## 🤝 Contributing Guidelines

1. **Follow existing patterns**: Maintain consistency with current codebase
2. **Test coverage**: Add tests for new functionality
3. **Documentation**: Update relevant documentation
4. **Code review**: Ensure changes align with architectural principles
5. **Performance impact**: Consider impact on query performance and bundle size

---

_This guide should be updated as the codebase evolves and new patterns emerge._
