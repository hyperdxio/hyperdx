# Development Workflows

## Setup Commands

```bash
# Install dependencies and setup hooks
yarn setup

# Start full development stack (Docker + local services)
yarn dev
```

## Key Development Scripts

- `yarn app:dev`: Start API, frontend, alerts task, and common-utils in watch
  mode
- `yarn lint`: Run linting across all packages
- `yarn dev:int`: Run integration tests in watch mode
- `yarn dev:unit`: Run unit tests in watch mode (per package)
- `yarn test:e2e`: Run Playwright E2E tests (in `packages/app`)
- `yarn test:e2e:ci`: Run Playwright E2E tests in CI Docker environment (in
  `packages/app`)

## Environment Configuration

- `.env.development`: Development environment variables
- Docker Compose manages ClickHouse, MongoDB, OTel Collector
- Hot reload enabled for all services in development

## Testing Strategy

### Testing Tools

- **Unit Tests**: Jest with TypeScript support
- **Integration Tests**: Jest with database fixtures
- **Frontend Testing**: React Testing Library + Jest
- **E2E Testing**: Playwright (frontend) and Custom smoke tests with BATS
  (ingestion)

### Testing Patterns

- **TDD Approach**: Write tests before implementation for new features
- **Test organization**: Tests co-located with source files in `__tests__/`
  directories
- **Mocking**: MSW for API mocking in frontend tests
- **Database testing**: Isolated test databases with fixtures

### CI / Integration Testing

For integration testing:

```bash
# Build dependencies (run once before first test run)
make dev-int-build

# Run API integration tests (spins up Docker services, runs tests, tears down)
make dev-int FILE=<TEST_FILE_NAME>

# Run common-utils integration tests
make dev-int-common-utils FILE=<TEST_FILE_NAME>
```

**Multi-agent / worktree support:**

The `make dev-int` command automatically assigns unique Docker ports per
worktree directory, so multiple agents can run integration tests in parallel
without port conflicts.

- A deterministic slot (0-99) is computed from the worktree directory name
- Each slot gets its own Docker Compose project name and port range
- Override the slot manually: `make dev-int HDX_CI_SLOT=5 FILE=alerts`
- The slot and assigned ports are printed when `dev-int` starts

Port mapping (base + slot):

| Service         | Default port (slot 0) | Variable          |
| --------------- | --------------------- | ----------------- |
| ClickHouse HTTP | 18123                 | HDX_CI_CH_PORT    |
| MongoDB         | 39999                 | HDX_CI_MONGO_PORT |
| API test server | 19000                 | HDX_CI_API_PORT   |
| OpAMP           | 14320                 | HDX_CI_OPAMP_PORT |

**CI Testing Notes:**

- Uses separate Docker Compose configuration (`docker-compose.ci.yml`)
- Isolated test environment with unique `-p int-<slot>` project name
- Includes all necessary services (ClickHouse, MongoDB, OTel Collector)
- Tests run against real database instances for accurate integration testing

## Common Development Tasks

### Adding New Features

1. **API First**: Define API endpoints and data models
2. **Database Models**: Create/update Mongoose schemas and ClickHouse queries
3. **Frontend Integration**: Build UI components and integrate with API
4. **Testing**: Add unit and integration tests
5. **Documentation**: Update relevant docs

### Debugging

- Check browser and server console output for errors, warnings, or relevant logs
- Add targeted logging to trace execution and variable states
- For persistent issues, check `fixes/` directory for documented solutions
- Document complex fixes in `fixes/` directory with descriptive filenames

## Code Quality

### Pre-commit Hooks

The project uses Husky + lint-staged to automatically run:

- Prettier for formatting
- ESLint for linting
- API doc generation (for external API changes)

These run automatically on `git commit` for staged files.

### Manual Linting (if needed)

If you need to manually lint:

```bash
# Per-package linting with auto-fix
cd packages/app && yarn run lint:fix
cd packages/api && yarn run lint:fix
cd packages/common-utils && yarn lint:fix

# Check all packages
yarn run lint
```

## File Locations Quick Reference

- **Config**: `packages/api/src/config.ts`, `packages/app/next.config.mjs`,
  `docker-compose.dev.yml`
- **Models**: `packages/api/src/models/`
- **API Routes**: `packages/api/src/routers/`
- **Controllers**: `packages/api/src/controllers/`
- **Pages**: `packages/app/pages/`
- **Components**: `packages/app/src/`
- **Shared Utils**: `packages/common-utils/src/`
