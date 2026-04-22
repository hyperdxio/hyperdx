/**
 * Global setup for full-stack E2E tests
 *
 * This setup:
 * 1. Clears MongoDB database to ensure clean state
 * 2. Creates a test user and team
 * 3. Applies DEFAULT_SOURCES from .env.e2e
 * 4. Saves authentication state for tests
 *
 * Full-stack mode uses:
 * - MongoDB (local) for authentication, teams, users, persistence
 * - API server (local) for backend logic
 * - Demo ClickHouse (remote) for telemetry data (logs, traces, metrics, K8s)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { chromium, FullConfig } from '@playwright/test';

import { seedClickHouse } from './seed-clickhouse';

// Configuration constants
const API_HEALTH_CHECK_MAX_RETRIES = parseInt(
  process.env.E2E_API_HEALTH_CHECK_MAX_RETRIES || '30',
  10,
);
const API_HEALTH_CHECK_RETRY_DELAY_MS = 1000;
const SOURCE_SELECTOR_TIMEOUT_MS = 10000;
const PAGE_LOAD_TIMEOUT_MS = 30000;

// Password must be at least 8 characters with uppercase, lowercase, number, and special char
const DEFAULT_TEST_USER = {
  email: process.env.E2E_TEST_USER_EMAIL || 'e2e-test@hyperdx.io',
  password: process.env.E2E_TEST_USER_PASSWORD || 'TestPassword123!',
} as const;

// Port configuration from HDX_E2E_* env vars (set by scripts/test-e2e.sh)
const API_PORT = process.env.HDX_E2E_API_PORT || '21000';
const APP_PORT = process.env.HDX_E2E_APP_PORT || '21300';
const MONGO_PORT = process.env.HDX_E2E_MONGO_PORT || '21100';

const API_URL = process.env.E2E_API_URL || `http://localhost:${API_PORT}`;
const APP_URL = process.env.E2E_APP_URL || `http://localhost:${APP_PORT}`;
const AUTH_FILE = path.join(__dirname, '.auth/user.json');
const MONGO_URI =
  process.env.MONGO_URI || `mongodb://localhost:${MONGO_PORT}/hyperdx-e2e`;

/**
 * Seeded test data with predictable identifiers so E2E tests can look it up.
 * Exported so tests can reference the same constants instead of hard-coding.
 */
export const SEEDED_ERROR_ALERT = {
  savedSearchName: 'E2E Errored Alert Search',
  webhookName: 'E2E Error Webhook',
  // URL gets appended with a unique suffix inside the seeder to stay idempotent
  // if the user record already exists (409 path).
  webhookUrlBase: 'https://example.com/e2e-error-webhook',
  errorType: 'QUERY_ERROR',
  errorMessage:
    'ClickHouse returned 500: DB::Exception: Timeout exceeded: elapsed 30s, maximum: 30s while executing query.',
};

/**
 * Run a mongosh script against the e2e MongoDB container by piping the script
 * through stdin. Using stdin (rather than `--eval "<...>"`) avoids having to
 * escape quotes in the script body, so callers can pass multi-line JavaScript
 * with string literals verbatim.
 *
 * Throws if the docker-compose file can't be found (meaning we're not running
 * in the expected Docker-backed e2e environment).
 */
function runMongoshScript(script: string): string {
  const dockerComposeFile = path.join(__dirname, 'docker-compose.yml');
  if (!fs.existsSync(dockerComposeFile)) {
    throw new Error(
      `docker-compose.yml not found at ${dockerComposeFile} — e2e Docker stack unavailable`,
    );
  }

  const e2eSlot = process.env.HDX_E2E_SLOT || '0';
  const e2eProject = `e2e-${e2eSlot}`;

  return execSync(
    `docker compose -p ${e2eProject} -f "${dockerComposeFile}" exec -T db mongosh --quiet`,
    {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: script,
    },
  );
}

/**
 * Clears the MongoDB database to ensure a clean slate for tests
 */
function clearDatabase() {
  console.log('Clearing MongoDB database for fresh test run...');

  try {
    runMongoshScript("use('hyperdx-e2e'); db.dropDatabase();");
    console.log('  ✓ Database cleared successfully (via Docker)');
  } catch (error) {
    console.warn('  ⚠ Warning: Could not clear database');
    console.warn(`  ${error instanceof Error ? error.message : String(error)}`);
    console.warn(
      '  This may cause issues if old data exists from previous test runs',
    );
    console.warn(
      '  Consider manually clearing the database or setting E2E_UNIQUE_USER=true',
    );
  }
}

async function globalSetup(_config: FullConfig) {
  console.log('Setting up full-stack E2E environment');
  console.log('  MongoDB: local (auth, teams, persistence)');
  console.log('  ClickHouse: local instance (telemetry data)');

  // Set timezone
  process.env.TZ = 'America/New_York';

  // Seed ClickHouse with test data
  await seedClickHouse();

  // Clean up any existing auth state to ensure fresh setup
  if (fs.existsSync(AUTH_FILE)) {
    console.log('  Removing existing auth state');
    fs.unlinkSync(AUTH_FILE);
  }

  // Generate unique test user if E2E_UNIQUE_USER is set (useful for parallel CI runs)
  const MOCK_USER =
    process.env.E2E_UNIQUE_USER === 'true'
      ? {
          email: `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@hyperdx.io`,
          password: DEFAULT_TEST_USER.password,
        }
      : { ...DEFAULT_TEST_USER };

  if (process.env.E2E_UNIQUE_USER === 'true') {
    console.log(`  Using unique test user: ${MOCK_USER.email}`);
  }

  // Wait for API server to be ready
  console.log('Waiting for API server to be ready...');

  for (let i = 0; i < API_HEALTH_CHECK_MAX_RETRIES; i++) {
    try {
      const response = await fetch(`${API_URL}/health`).catch(() => null);
      if (response?.ok) {
        console.log('  API server is ready');
        break;
      }
    } catch {
      // Continue retrying
    }

    if (i === API_HEALTH_CHECK_MAX_RETRIES - 1) {
      throw new Error(
        `API server not ready after ${(API_HEALTH_CHECK_MAX_RETRIES * API_HEALTH_CHECK_RETRY_DELAY_MS) / 1000} seconds`,
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, API_HEALTH_CHECK_RETRY_DELAY_MS),
    );
  }

  // Clear MongoDB database to ensure DEFAULT_SOURCES is applied
  clearDatabase();

  // Create test user and save auth state
  console.log('Creating test user and logging in');

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: APP_URL });
  const page = await context.newPage();

  try {
    // Register user
    console.log(`  Registering user: ${MOCK_USER.email}`);
    const registerResponse = await page.request.post(
      `${API_URL}/register/password`,
      {
        data: {
          email: MOCK_USER.email,
          password: MOCK_USER.password,
          confirmPassword: MOCK_USER.password,
        },
      },
    );

    if (!registerResponse.ok()) {
      const status = registerResponse.status();
      const body = await registerResponse.text();

      // 409 Conflict should not happen since we cleared the database
      // If it does, it indicates the database clear failed
      if (status === 409) {
        console.warn(
          '  ⚠ Warning: User/team already exists (409 Conflict) - database may not have been cleared',
        );
        console.warn(
          '  DEFAULT_SOURCES will NOT be applied (only happens on new team creation)',
        );
        console.warn('  Tests may fail due to stale or incorrect sources');
      } else {
        // Any other error is a real failure
        throw new Error(`Registration failed: ${status} ${body}`);
      }
    } else {
      console.log('  ✓ User registered successfully');
      console.log('  ✓ DEFAULT_SOURCES applied to new team');
    }

    // Login
    console.log('  Logging in');
    const loginResponse = await page.request.post(`${API_URL}/login/password`, {
      data: {
        email: MOCK_USER.email,
        password: MOCK_USER.password,
      },
      failOnStatusCode: false,
    });

    // Login returns 302 redirect on success
    if (loginResponse.status() !== 302 && !loginResponse.ok()) {
      const body = await loginResponse.text();
      throw new Error(`Login failed: ${loginResponse.status()} ${body}`);
    }

    // Navigate to the app to establish session
    await page.goto('/', { timeout: PAGE_LOAD_TIMEOUT_MS });

    console.log('  Login successful');

    // Verify default sources were auto-created (via DEFAULT_SOURCES env var)
    console.log('Verifying default sources were created');
    let sourcesResponse;
    try {
      sourcesResponse = await page.request.get(`${API_URL}/sources`);
    } catch (error) {
      console.error('  Network error fetching sources:', error);
      throw new Error(
        `Failed to connect to API at ${API_URL}/sources - is the API server running?`,
      );
    }

    if (!sourcesResponse.ok()) {
      const errorText = await sourcesResponse.text();
      console.error(
        `  API error fetching sources: ${sourcesResponse.status} ${errorText}`,
      );

      if (
        sourcesResponse.status() === 401 ||
        sourcesResponse.status() === 403
      ) {
        throw new Error('Authentication failed - check session setup');
      } else if (sourcesResponse.status() >= 500) {
        throw new Error(
          `API server error (${sourcesResponse.status()}) - check API logs`,
        );
      } else {
        throw new Error(`Failed to fetch sources: ${sourcesResponse.status()}`);
      }
    }

    const sources = await sourcesResponse.json();
    console.log(`  Found ${sources.length} default sources`);
    if (sources.length === 0) {
      console.error('  ❌ ERROR: No sources found');
      console.error(
        '  This should not happen since we just created a fresh team',
      );
      console.error(
        '  Check that DEFAULT_SOURCES is properly configured in packages/api/.env.e2e',
      );
      throw new Error(
        'No sources found - DEFAULT_SOURCES may be misconfigured',
      );
    } else {
      console.log('  ✓ Sources configured:');
      sources.forEach((source: any) => {
        console.log(`    - ${source.name} (${source.kind})`);
      });
    }

    // Navigate to search page to ensure sources are loaded
    console.log('Navigating to search page');
    await page.goto('/search', { timeout: PAGE_LOAD_TIMEOUT_MS });

    // Wait for source selector to be ready (indicates sources are loaded)
    await page.waitForSelector('[data-testid="source-selector"]', {
      state: 'visible',
      timeout: SOURCE_SELECTOR_TIMEOUT_MS,
    });

    // Save authentication state
    const authDir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    await context.storageState({ path: AUTH_FILE });
    console.log(`  Auth state saved to ${AUTH_FILE}`);

    // Seed an alert that has execution errors recorded so tests can exercise
    // the /alerts error-icon + modal UI without having to run the check-alerts
    // background job.
    await seedAlertWithErrors(page, API_URL, sources);

    console.log('Full-stack E2E setup complete');
    console.log(
      '  Using local ClickHouse with seeded test data for logs, traces, metrics, and K8s',
    );
  } catch (error) {
    console.error('Setup failed:', error);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * Seeds an alert with a recorded execution error. The alert is created via the
 * API (so all referenced documents — saved search, webhook — exist and the
 * alerts list endpoint populates correctly), then the `errors` array is
 * patched in directly via mongosh since it's only ever set by the check-alerts
 * background job in normal operation.
 */
async function seedAlertWithErrors(
  page: import('@playwright/test').Page,
  apiUrl: string,
  sources: Array<{ _id: string; kind: string }>,
) {
  console.log('Seeding alert with errors for UI tests');

  const logSource = sources.find(s => s.kind === 'log');
  if (!logSource) {
    console.warn('  ⚠ No log source available — skipping alert seed');
    return;
  }

  // 1) Saved search for the alert to reference. The router is mounted at
  // `/saved-search` (see api-app.ts) — not `/savedSearches`.
  const savedSearchRes = await page.request.post(`${apiUrl}/saved-search`, {
    data: {
      name: SEEDED_ERROR_ALERT.savedSearchName,
      select: '',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      source: logSource._id,
      tags: [],
    },
  });
  if (!savedSearchRes.ok()) {
    console.warn(
      `  ⚠ Could not create saved search (${savedSearchRes.status()}): ${await savedSearchRes.text()}`,
    );
    return;
  }
  const savedSearch = await savedSearchRes.json();

  // 2) Webhook for the alert's notification channel. Use a timestamped URL so
  // a stale team (e.g. if clearDatabase silently failed) doesn't collide with
  // the webhook uniqueness constraint on (team, service, url).
  const uniqueUrl = `${SEEDED_ERROR_ALERT.webhookUrlBase}-${Date.now()}`;
  const webhookRes = await page.request.post(`${apiUrl}/webhooks`, {
    data: {
      name: SEEDED_ERROR_ALERT.webhookName,
      service: 'generic',
      url: uniqueUrl,
      body: JSON.stringify({ text: '{{title}}' }),
    },
  });
  if (!webhookRes.ok()) {
    console.warn(
      `  ⚠ Could not create webhook (${webhookRes.status()}): ${await webhookRes.text()}`,
    );
    return;
  }
  const webhook = (await webhookRes.json()).data;

  // 3) Alert — saved search source, referencing the webhook above.
  const alertRes = await page.request.post(`${apiUrl}/alerts`, {
    data: {
      source: 'saved_search',
      savedSearchId: savedSearch._id ?? savedSearch.id,
      channel: { type: 'webhook', webhookId: webhook._id ?? webhook.id },
      interval: '5m',
      threshold: 1,
      thresholdType: 'above',
      name: 'E2E Errored Alert',
    },
  });
  if (!alertRes.ok()) {
    console.warn(
      `  ⚠ Could not create alert (${alertRes.status()}): ${await alertRes.text()}`,
    );
    return;
  }
  const alert = (await alertRes.json()).data;
  const alertId: string = alert._id ?? alert.id;

  // 4) Patch the `executionErrors` array directly via mongosh. The
  // check-alerts job is the only code that writes this field in normal
  // operation, so we write it here to avoid having to run that job during
  // setup.
  const patchScript = `
use('hyperdx-e2e');
db.alerts.updateOne(
  { _id: ObjectId(${JSON.stringify(alertId)}) },
  {
    $set: {
      executionErrors: [
        {
          timestamp: new Date(),
          type: ${JSON.stringify(SEEDED_ERROR_ALERT.errorType)},
          message: ${JSON.stringify(SEEDED_ERROR_ALERT.errorMessage)}
        }
      ],
      state: 'OK'
    }
  }
);
`;

  try {
    runMongoshScript(patchScript);
    console.log(
      `  ✓ Seeded alert "${alert.name}" (${alertId}) with a ${SEEDED_ERROR_ALERT.errorType}`,
    );
  } catch (error) {
    console.warn(
      `  ⚠ Could not patch alert errors: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default globalSetup;
