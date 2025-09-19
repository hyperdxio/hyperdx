# End-to-End Testing

This directory contains Playwright-based end-to-end tests for the HyperDX application. The tests are organized into core functionality and feature-specific test suites.

## Prerequisites

- Node.js (version specified in `.nvmrc`)
- Dependencies installed via `yarn install`
- Development server running (automatically handled by test configuration)

## Running Tests

### All Tests

To run the complete test suite:

```bash
# From project root
make dev-e2e

# Or from packages/app directory
yarn test:e2e
```

### Tagged Tests

Tests are organized using tags to allow selective execution:

```bash
# Run smoke tests only
make dev-e2e tags="@smoke"

# Run core functionality tests
make dev-e2e tags="@core"

# Run search-related tests
make dev-e2e tags="@search"

# Run dashboard tests
make dev-e2e tags="@dashboard"

# Run trace workflow tests
make dev-e2e tags="@traces"

# Run session tests
make dev-e2e tags="@sessions"

# Run alert tests
make dev-e2e tags="@alerts"

# Run chart explorer tests
make dev-e2e tags="@charts"
```

### Local Mode vs Full Server

Some tests require a full server setup and are tagged with `@full-server`. Tests tagged with `@local-mode` can run against the local development server without external dependencies.

## Test Organization

```
tests/e2e/
├── core/                 # Core application functionality
│   ├── modals.spec.ts    # Modal interactions
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
│   ├── sources.spec.ts
│   └── traces-workflow.spec.ts
└── utils/                # Test utilities and helpers
    ├── base-test.ts
    └── test-setup.ts
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

- **Base URL**: `http://localhost:8080`
- **Timeout**: 30 seconds per test
- **Retries**: 1 retry on local, 2 on CI
- **Workers**: 1 worker locally, 2 on CI
- **Screenshots**: Captured on failure
- **Videos**: Recorded for failed tests

## Test Development

### Writing Tests

Tests use the extended base test from `utils/base-test.ts` which provides:
- Automatic handling of onboarding modals
- Tanstack Query devtools management
- Network idle waiting after navigation

### Test Utilities

Common utilities are available in `utils/test-setup.ts`:
- User registration and login helpers
- Modal handling functions
- Authentication state management

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
3. Increase wait timeouts if necessary
4. Use the trace viewer to analyze test execution

### CI/CD Integration

Tests are configured to run in CI environments with:
- Increased timeout values
- Multiple retry attempts
- Artifact collection for failed tests
- GitHub Actions integration for PR comments
