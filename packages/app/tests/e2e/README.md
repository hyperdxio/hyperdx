# End-to-End Testing

This directory contains Playwright-based end-to-end tests for the HyperDX
application. The tests are organized into core functionality and
feature-specific test suites.

## Prerequisites

- Node.js (>=22.16.0 as specified in package.json)
- Dependencies installed via `yarn install`
- Development server running (automatically handled by test configuration)

## Running Tests

### Default: Full-Stack Mode

By default, `make e2e` runs tests in **full-stack mode** with MongoDB + API + demo ClickHouse for maximum consistency and real backend features:

```bash
# Run all tests (full-stack with MongoDB + API + demo ClickHouse)
make e2e

# Run specific tests (full-stack)
make e2e tags="@kubernetes"
make e2e tags="@smoke"
```

### Optional: Local Mode (Frontend Only)

For faster iteration during development, use `local=true` to skip MongoDB and run frontend-only tests:

```bash
# Run all tests in local mode (no MongoDB, frontend only)
make e2e local=true

# Run specific tests in local mode
make e2e local=true tags="@search"
```

**When to use local mode:**
- Quick frontend iteration during development
- Testing UI components that don't need auth/persistence
- Faster test execution when you don't need backend features

### Test Modes

#### Full-Stack Mode (Default)
**Default behavior** - runs with real backend (MongoDB + API) and demo ClickHouse data.

**What it includes:**
- MongoDB (port 29998) - authentication, teams, users, persistence
- API Server (port 29000) - full backend logic
- App Server (port 28081) - frontend
- **Demo ClickHouse** (remote) - pre-populated logs/traces/metrics/K8s data

**Benefits:**
- Test authentication flows (login, signup, teams)
- Test persistence (saved searches, dashboards, alerts)
- Test real API endpoints and backend logic
- Consistent with production environment
- All features work (auth, persistence, data querying)

```bash
# Default: full-stack mode
make e2e
make e2e tags="@kubernetes"
```

#### Local Mode (Opt-in for Speed)
**Frontend-only mode** - skips MongoDB/API, connects directly to demo ClickHouse from browser.

**Use for:**
- Quick frontend iteration during development
- Testing UI components that don't need auth
- Faster test execution when backend features aren't needed

**Limitations:**
- No authentication (no login/signup)
- No persistence (can't save searches/dashboards)
- No API calls (queries go directly to demo ClickHouse)

```bash
# Opt-in to local mode for speed
make e2e local=true
make e2e local=true tags="@search"
```

## Writing Tests

Since full-stack is the default, all tests have access to authentication, persistence, and real backend features:

```typescript
import { expect, test } from '../../utils/base-test';

test.describe('My Feature', () => {
  test('should allow authenticated user to save search', async ({ page }) => {
    // User is already authenticated (via global setup in full-stack mode)
    await page.goto('/search');

    // Query demo ClickHouse data
    await page.fill('[data-testid="search-input"]', 'ServiceName:"frontend"');
    await page.click('[data-testid="search-submit-button"]');

    // Save search (uses real MongoDB for persistence)
    await page.click('[data-testid="save-search-button"]');
    await page.fill('[data-testid="search-name-input"]', 'My Saved Search');
    await page.click('[data-testid="confirm-save"]');

    // Verify saved search persists
    await page.goto('/saved-searches');
    await expect(page.getByText('My Saved Search')).toBeVisible();
  });
});
```

**Note:** Tests that need to run in local mode (frontend-only) should be tagged with `@local-mode` and explicitly run with `make e2e local=true`.

## Test Organization

```
tests/e2e/
├── core/                 # Core application functionality
│   └── navigation.spec.ts # Navigation and routing
├── features/             # Feature-specific tests
│   ├── alerts.spec.ts
│   ├── chart-explorer.spec.ts
│   ├── dashboard.spec.ts
│   ├── search/
│   │   ├── search.spec.ts
│   │   ├── search-filters.spec.ts
│   │   └── saved-search.spec.ts
│   ├── sessions.spec.ts
│   └── traces-workflow.spec.ts
└── utils/                # Test utilities and helpers
    └── base-test.ts
```

## Debugging Tests

### Interactive Mode

Run tests with the Playwright UI for interactive debugging:

```bash
yarn test:e2e:ui
```

### Debug Mode

Run tests in debug mode with browser developer tools:

```bash
yarn test:e2e:debug
```

### CI Mode

Run tests in ci mode, which runs it in a docker container and environment
similar to how it runs inside of Github Actions

```bash
yarn test:e2e:ci
```

### Single Test Debugging

To debug a specific test file:

```bash
yarn test:e2e tests/e2e/features/search/search.spec.ts --debug
```

### Headed Mode

Run tests in headed mode (visible browser):

```bash
yarn test:e2e --headed
```

## Test Output and Reports

### HTML Reports

After test execution, view the detailed HTML report:

```bash
yarn playwright show-report
```

The report includes:

- Test execution timeline
- Screenshots of failures
- Video recordings of failed tests
- Network logs and console output

### Test Results

Test artifacts are stored in:

- `test-results/` - Screenshots, videos, and traces for failed tests
- `playwright-report/` - HTML report files

### Trace Viewer

For detailed debugging of failed tests, use the trace viewer:

```bash
yarn playwright show-trace test-results/[test-name]/trace.zip
```

## Configuration

The test configuration is defined in `playwright.config.ts`:

- **Base URL**: `http://localhost:8080` (configurable via `PLAYWRIGHT_BASE_URL`)
- **Test Timeout**: 60 seconds (increased from default 30s to reduce flaky test
  failures)
- **Retries**: 1 retry locally, 2 on CI
- **Workers**: Undefined (uses Playwright defaults)
- **Screenshots**: Captured on failure only
- **Videos**: Recorded and retained on failure
- **Traces**: Collected on first retry
- **Global Setup**: Ensures server readiness before tests
- **Web Server**: Automatically starts local dev server with local mode enabled

## Test Development

### Writing Tests

Tests use the extended base test from `utils/base-test.ts` which provides:

- Automatic handling of connection/sources
- Tanstack Query devtools management
- Network idle waiting after navigation

### Best Practices

- Use data test IDs for reliable element selection
- Implement proper wait strategies for dynamic content
- Group related assertions in test steps
- Use descriptive test names and organize with appropriate tags
- Clean up test data when necessary

## Configuration Details

### Port Configuration

**Local Environment (make e2e):**
- MongoDB: 29998 (custom port to avoid conflicts)
- API Server: 29000
- App Server: 28081

**CI Environment (GitHub Actions):**
- MongoDB: 27017 (default, accessed via service name `mongodb`)
- API Server: 29000
- App Server: 28081

The MongoDB port differs between local and CI to:
- Avoid conflicts with existing MongoDB instances locally (port 27017)
- Use standard ports in isolated CI containers (port 27017)
- CI accesses MongoDB via hostname `mongodb` instead of `localhost`

### Playwright Configuration

The test setup uses Playwright's `webServer` array feature (v1.32+) to start multiple servers:
- API server (port 29000) - loads `.env.e2e` configuration
- App server (port 28081) - connects to API

This requires Playwright v1.32.0 or higher. Current version: v1.57.0

## Troubleshooting

### Common Issues

**Server connection errors:**
- Port 28081 (full-stack) or 8081 (local mode) already in use
- Check development server started successfully
- Verify environment variables in `.env.e2e`

**MongoDB connection issues (full-stack mode):**
- Check port 29998 is available locally: `lsof -i :29998`
- View MongoDB logs: `docker compose -p e2e -f tests/e2e/docker-compose.yml logs`
- MongoDB is auto-managed by `make e2e` (default)
- Note: CI uses port 27017 internally (accessed via service name)

**Sources don't appear in UI:**
- Check API logs for `setupTeamDefaults` errors
- Verify `DEFAULT_SOURCES` in `.env.e2e` points to demo ClickHouse
- Ensure you registered a new user (DEFAULT_SOURCES only applies to new teams)

**Tests can't find demo data:**
- Verify sources use `otel_v2` database (demo ClickHouse)
- Check Network tab - should query `sql-clickhouse.clickhouse.com`
- Verify a source is selected in UI dropdown

### Flaky Tests

For intermittent failures:

1. Check the HTML report for timing issues
2. Review network logs for failed requests
3. Consider if individual test steps need longer wait times (global timeout is
   now 60s)
4. Use the trace viewer to analyze test execution

### CI/CD Integration

Tests run in **full-stack mode** on CI (GitHub Actions) with:

- MongoDB service container for authentication and persistence
- Demo ClickHouse for telemetry data
- 60-second test timeout (same as local)
- Multiple retry attempts (2 retries on CI vs 1 locally)
- Artifact collection for failed tests
- GitHub Actions integration for PR comments
- Parallel execution across 4 shards for faster feedback
