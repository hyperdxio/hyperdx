# Playwright E2E Tests

## File structure

- E2E tests are located in `packages/app/tests/e2e/features`

## Page objects

- Tests should interact with the UI through selectors and functions defined in `packages/app/tests/e2e/page-objects`.
- Page objects should refer to UI elements using data-testid if possible. Add data-testid values to existing pages when necessary.

## Running the tests

To verify that the tests pass:

```sh
./scripts/test-e2e.sh
```

## Mock ClickHouse Data

- E2E tests run against a local docker environment, where backend ClickHouse data is mocked
- Update the `packages/app/tests/e2e/seed-clickhouse.ts` if (and only if) the scenario requires specific data

## Best Practices

- **Assert successful chart loads** by checking that `.recharts-responsive-container` is visible.