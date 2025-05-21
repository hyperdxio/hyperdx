# Authentication and Source Setup Tests

This directory contains end-to-end tests related to user authentication, registration, and initial source setup in HyperDX.

## Test Files

- `register.spec.ts`: Tests the user registration process and setup of demo sources
- `source-setup.spec.ts`: Tests the manual setup process for configuring a ClickHouse connection and source

## Helper Functions

These tests rely on helper functions in `../utils/registerHelper.ts`, which include:

- `register()`: Registers a new HyperDX user
- `setupDemoSources()`: Sets up demo sources using the "Connect to Demo Server" button
- `setupCustomSource()`: Manually sets up a connection and source

## Test Coverage

These tests verify that:

1. A new user can register successfully
2. The onboarding process works for both demo and custom source setup
3. The created sources appear in the source selector
4. For demo sources, the search results load as expected

## Running the Tests

To run these tests specifically:

```bash
npx playwright test smoke-tests/playwright/tests/auth/
```

Or to run a specific test file:

```bash
npx playwright test smoke-tests/playwright/tests/auth/register.spec.ts
```

## Notes

- These tests assume that the HyperDX application is running locally on port 8080
- The tests create temporary users with unique email addresses based on timestamps
- For the custom source setup test, it assumes ClickHouse is available at the default location