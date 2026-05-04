---
name: playwright
description: Writes end-to-end tests code using Playwright browser automation.
---

# Playwright End-to-End Test Writer

I am a Playwright End-to-End Test Writer. I generate test code that simulates user interactions with the HyperDX application in a real browser environment, allowing us to verify that the application behaves as expected from the user's perspective.

I will write tests covering these requirements: $ARGUMENTS.

If the requirements are empty or unclear, I will ask the user for a detailed description of the test they want.

## Workflow

Use the agents below to carry out each phase. Do not write test code directly in the main context.

### 1. Test Generation
Delegate to the **`playwright-test-generator`** agent (via the Agent tool). Pass it:
- A full description of the test scenario including steps, expected outcomes, and edge cases
- The target spec file path (`packages/app/tests/e2e/features/<feature>.spec.ts`)
- Any relevant page object files that already exist for this feature

The agent will drive a real browser, execute the steps live, and produce spec code that follows HyperDX conventions. Review the output before proceeding.

NOTE: When there is an existing spec file covering the feature, add new tests to the existing file instead of creating a new one. This keeps related tests together and avoids fragmentation.

### 2. Test Execution
After the generator agent writes the file, run the test:

```bash
./scripts/test-e2e.sh --quiet <test-file-name> [--grep "\"<test name pattern>\""]
```

Always run in full-stack mode (default). Do not ask the user about this.

### 3. Iterative Fixing
If the test fails, delegate to the **`playwright-test-healer`** agent (via the Agent tool). Pass it:
- The failing test file path
- The error output
- Any relevant context about what the test is supposed to do

The healer agent will debug interactively, fix the code, and re-run until the test passes.

## HyperDX Project Conventions

These conventions apply to ALL test code produced by any agent. Review generated output to ensure compliance.

### File Structure
- Specs: `packages/app/tests/e2e/features/`
- Page objects: `packages/app/tests/e2e/page-objects/`
- Components: `packages/app/tests/e2e/components/`
- Utilities: `packages/app/tests/e2e/utils/`
- Base test (extends playwright with fixtures): `utils/base-test.ts`
- Constants (source names): `utils/constants.ts`

### Page Object Pattern (REQUIRED)
- ALL UI interactions in spec files must go through page objects (`page-objects/`) and components (`components/`)
- No raw `page.getByTestId()`, `page.locator()`, or `page.getByRole()` calls directly in spec files
- If a needed interaction doesn't exist in a page object, add it to the page object — don't work around it in the spec

### Data Isolation (CRITICAL)
Tests run in parallel and share a database. Use `Date.now()` for **every field the API uniqueness-checks** — not just display names:

```typescript
const ts = Date.now();
const name = `E2E Thing ${ts}`;
const url = `https://example.com/thing-${ts}`; // URL too, not just name
```

The webhook API enforces uniqueness on `(team, service, url)`. A hardcoded URL will collide between parallel runs or retries.

### Assertions
- Never assert global counts (`toHaveCount(N)`) — other tests' data pollutes the page
- Scope assertions to the current test's data: `pageContainer.getByRole('link').filter({ hasText: name })`
- Use web-first assertions (`toBeVisible()`, `toBeHidden()`) not imperative checks
- Never use hardcoded waits (`waitForTimeout`) — wait for specific elements or conditions
- Assert successful chart loads by checking `.recharts-responsive-container` is visible

### Tags
- `{ tag: '@full-stack' }` — tests requiring MongoDB + API backend
- Feature tags: `@dashboard`, `@alerts`, `@search`, etc.

### Imports
Always import from the base test, not directly from `@playwright/test`:
```typescript
import { expect, test } from '../utils/base-test';
```

### Mock ClickHouse Data
- E2E tests run against a local Docker environment with seeded ClickHouse data
- Update `packages/app/tests/e2e/seed-clickhouse.ts` only if the scenario requires specific data not already seeded
