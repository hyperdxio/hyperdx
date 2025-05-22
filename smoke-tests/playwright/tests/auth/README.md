# Authentication and Source Setup Tests

This directory contains end-to-end tests related to user authentication, registration, and initial source setup in HyperDX.

## Test Files

- `register.spec.ts`: Tests the user registration process and automatic setup of demo sources via environment variables
- `source-setup.spec.ts`: Tests the manual setup process for configuring a ClickHouse connection and source

## Auto-Provisioning Sources

HyperDX supports two methods for setting up sources during user registration:

1. **Environment Variables (Preferred)**: Using `DEFAULT_CONNECTIONS` and `DEFAULT_SOURCES` environment variables in docker-compose.yml
2. **Manual Setup**: Using the "Connect to Demo Server" button or filling out connection/source forms

The `register.spec.ts` test now verifies that sources are automatically created when a new user registers, using the auto-provisioning feature from environment variables.

## Helper Functions

These tests rely on helper functions in `../utils/registerHelper.ts`, which include:

- `register()`: Registers a new HyperDX user
- `setupDemoSources()`: Sets up demo sources using the "Connect to Demo Server" button (used as fallback)
- `setupCustomSource()`: Manually sets up a connection and source

## Test Coverage

These tests verify that:

1. A new user can register successfully
2. Auto-provisioning works when environment variables are set properly
3. Manual onboarding process works for both demo and custom source setup
4. The created sources appear in the source selector
5. For demo sources, the search results load as expected

## Running the Tests

To run these tests specifically:

```bash
npx playwright test smoke-tests/playwright/tests/auth/
```

Or to run a specific test file:

```bash
npx playwright test smoke-tests/playwright/tests/auth/register.spec.ts
```

## Environment Variables

The auto-provisioning system uses two environment variables:

- `DEFAULT_CONNECTIONS`: JSON array of connection objects
- `DEFAULT_SOURCES`: JSON array of source objects

These are set in the docker-compose.yml file and are used when a new user registers to automatically create the specified connections and sources.

## Notes

- These tests assume that the HyperDX application is running locally on port 8080
- The tests create temporary users with unique email addresses based on timestamps
- For the custom source setup test, it assumes ClickHouse is available at the default location