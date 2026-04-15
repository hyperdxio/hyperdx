# Development Workflows

## Setup Commands

```bash
# Install dependencies and setup hooks
yarn setup

# Start full development stack (auto-assigns unique ports per worktree)
yarn dev        # or equivalently: make dev
```

## Key Development Scripts

- `yarn dev` / `make dev`: Start full dev stack with worktree-isolated ports. A
  dev portal at http://localhost:9900 auto-starts showing all running stacks.
- `yarn dev:down` / `make dev-down`: Stop the dev stack for the current worktree
- `make dev-portal`: Start the dev portal manually (auto-started by `yarn dev`)
- `yarn lint`: Run linting across all packages
- `yarn dev:unit`: Run unit tests in watch mode (per package)

## Environment Configuration

- `.env.development`: Development environment variables
- Docker Compose manages ClickHouse, MongoDB, OTel Collector
- Hot reload enabled for all services in development

## Worktree Isolation (Multi-Agent / Multi-Developer)

When multiple git worktrees need to run the dev stack simultaneously (e.g.
multiple agents or developers working in parallel), use `make dev` instead of
`yarn dev`. This automatically assigns unique ports per worktree.

### How It Works

1. A deterministic slot (0-99) is computed from the worktree directory name (via
   `cksum`)
2. Each service gets a unique port: `base + slot` (see table below)
3. Docker Compose runs with a unique project name (`hdx-dev-<slot>`)
4. Volume paths include the slot to prevent data corruption between worktrees

### Dev Port Mapping (base + slot)

Ports are allocated in the 30100-31199 range to avoid conflicts with CI
integration tests (14320-40098) and E2E tests (20320-21399).

| Service           | Base Port | Range         | Env Variable                  |
| ----------------- | --------- | ------------- | ----------------------------- |
| API server        | 30100     | 30100 - 30199 | `HYPERDX_API_PORT`            |
| App (Next.js)     | 30200     | 30200 - 30299 | `HYPERDX_APP_PORT`            |
| OpAMP             | 30300     | 30300 - 30399 | `HYPERDX_OPAMP_PORT`          |
| MongoDB           | 30400     | 30400 - 30499 | `HDX_DEV_MONGO_PORT`          |
| ClickHouse HTTP   | 30500     | 30500 - 30599 | `HDX_DEV_CH_HTTP_PORT`        |
| ClickHouse Native | 30600     | 30600 - 30699 | `HDX_DEV_CH_NATIVE_PORT`      |
| OTel health       | 30700     | 30700 - 30799 | `HDX_DEV_OTEL_HEALTH_PORT`    |
| OTel gRPC         | 30800     | 30800 - 30899 | `HDX_DEV_OTEL_GRPC_PORT`      |
| OTel HTTP         | 30900     | 30900 - 30999 | `HDX_DEV_OTEL_HTTP_PORT`      |
| OTel metrics      | 31000     | 31000 - 31099 | `HDX_DEV_OTEL_METRICS_PORT`   |
| OTel JSON HTTP    | 31100     | 31100 - 31199 | `HDX_DEV_OTEL_JSON_HTTP_PORT` |
| RustFS S3 API     | 31300     | 31300 - 31399 | `HDX_DEV_RUSTFS_API_PORT`     |
| RustFS Console    | 31400     | 31400 - 31499 | `HDX_DEV_RUSTFS_CONSOLE_PORT` |

### Dev Portal

The dev portal is a centralized web dashboard that discovers all running
worktree stacks by inspecting Docker container labels and slot files.

```bash
# Start the portal (runs on fixed port 9900)
make dev-portal

# Open in browser
open http://localhost:9900
```

The portal auto-refreshes every 3 seconds and shows each worktree's:

- Branch name and slot number
- All services with status (running/stopped) and clickable port links
- Separate cards for each active worktree

### Overriding the Slot

```bash
# Use a specific slot instead of the auto-computed one
HDX_DEV_SLOT=5 make dev
```

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

### E2E Testing

E2E tests use the same slot-based isolation pattern as integration tests, with
their own dedicated port range (20320-21399) so they can run simultaneously with
both the dev stack and CI integration tests.

E2E port mapping (base + slot):

| Service           | Base Port | Range         | Env Variable             |
| ----------------- | --------- | ------------- | ------------------------ |
| OpAMP             | 20320     | 20320 - 20419 | `HDX_E2E_OPAMP_PORT`     |
| ClickHouse HTTP   | 20500     | 20500 - 20599 | `HDX_E2E_CH_PORT`        |
| ClickHouse Native | 20600     | 20600 - 20699 | `HDX_E2E_CH_NATIVE_PORT` |
| API server        | 21000     | 21000 - 21099 | `HDX_E2E_API_PORT`       |
| MongoDB           | 21100     | 21100 - 21199 | `HDX_E2E_MONGO_PORT`     |
| App (local)       | 21200     | 21200 - 21299 | `HDX_E2E_APP_LOCAL_PORT` |
| App (fullstack)   | 21300     | 21300 - 21399 | `HDX_E2E_APP_PORT`       |

```bash
# Run all E2E tests
make e2e

# Run a specific test file (dev mode: hot reload, containers kept running)
make dev-e2e FILE=navigation

# Run a specific test by grep pattern
make dev-e2e FILE=navigation GREP="help menu"

# Grep across all files
make dev-e2e GREP="should navigate"

# Open HTML report after tests finish (screenshots, traces, step-by-step)
make dev-e2e FILE=navigation REPORT=1

# Or call the script directly for more control
./scripts/test-e2e.sh --ui --last-failed

# Override the slot manually
HDX_E2E_SLOT=5 ./scripts/test-e2e.sh
```

- A deterministic slot (0-99) is computed from the worktree directory name
- Each slot gets its own Docker Compose project name (`e2e-<slot>`) and port
  range
- The slot and assigned ports are printed when E2E tests start

**Port range safety:** E2E has its own dedicated port range (20320-21399) that
does not overlap with CI integration tests (14320-40098) or the dev stack
(30100-31199), so all three can run simultaneously from the same worktree.

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
