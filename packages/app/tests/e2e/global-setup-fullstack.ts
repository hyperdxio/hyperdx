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

const API_URL = process.env.E2E_API_URL || 'http://localhost:29000';
const APP_URL = process.env.E2E_APP_URL || 'http://localhost:28081';
const AUTH_FILE = path.join(__dirname, '.auth/user.json');
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://localhost:29998/hyperdx-e2e';

/**
 * Clears the MongoDB database to ensure a clean slate for tests
 */
function clearDatabase() {
  console.log('Clearing MongoDB database for fresh test run...');

  try {
    const dockerComposeFile = path.join(__dirname, 'docker-compose.yml');
    if (fs.existsSync(dockerComposeFile)) {
      execSync(
        `docker compose -p e2e -f "${dockerComposeFile}" exec -T db mongosh --port 29998 --quiet --eval "use hyperdx-e2e; db.dropDatabase()" 2>&1`,
        { encoding: 'utf-8', stdio: 'pipe' },
      );
      console.log('  ✓ Database cleared successfully (via Docker)');
      return;
    }

    throw new Error('Could not connect to MongoDB');
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
    await page.waitForSelector('[data-testid="source-settings-menu"]', {
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

export default globalSetup;
