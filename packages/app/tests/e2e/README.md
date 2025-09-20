# End-to-End Testing

This directory contains Playwright-based end-to-end tests for the HyperDX application. The tests are organized into core functionality and feature-specific test suites.

## Prerequisites

- Node.js (>=22.16.0 as specified in package.json)
- Dependencies installed via `yarn install`
- Development server running (automatically handled by test configuration)

## Running Tests

### All Tests

To run the complete test suite:

```bash
# From project root
make e2e

# Or from packages/app directory
yarn test:e2e
```

### Tagged Tests

Tests are organized using tags to allow selective execution:

```bash
# Run smoke tests only
make e2e tags="@smoke"

# Run search-related tests
make e2e tags="@search"

# Run dashboard tests
make e2e tags="@dashboard"

# Run local-mode tests
make e2e tags="@local-mode"

# Or using yarn directly with grep
cd packages/app && yarn test:e2e --grep "@smoke"
cd packages/app && yarn test:e2e --grep "@search"
cd packages/app && yarn test:e2e --grep "@dashboard"
```

### Local Mode vs Full Server

Tests tagged with `@local-mode` can run against the local development server without external dependencies. The test configuration automatically starts a local development server with `NEXT_PUBLIC_IS_LOCAL_MODE=true`.

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
- **Test Timeout**: 60 seconds (increased from default 30s to reduce flaky test failures)
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

## Troubleshooting

### Server Connection Issues

If tests fail with connection errors:
1. Ensure no other services are running on port 8080
2. Check that the development server starts successfully
3. Verify environment variables are properly configured

### Flaky Tests

For intermittent failures:
1. Check the HTML report for timing issues
2. Review network logs for failed requests
3. Consider if individual test steps need longer wait times (global timeout is now 60s)
4. Use the trace viewer to analyze test execution

### CI/CD Integration

Tests are configured to run in CI environments with:
- 60-second test timeout (same as local)
- Multiple retry attempts (2 retries on CI vs 1 locally)
- Artifact collection for failed tests
- GitHub Actions integration for PR comments
