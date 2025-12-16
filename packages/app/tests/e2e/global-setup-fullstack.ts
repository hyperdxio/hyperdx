/**
 * Global setup for full-stack E2E tests
 * Creates a test user and saves authentication state
 *
 * Full-stack mode uses:
 * - MongoDB (local) for authentication, teams, users, persistence
 * - API server (local) for backend logic
 * - Demo ClickHouse (remote) for telemetry data (logs, traces, metrics, K8s)
 */

import fs from 'fs';
import path from 'path';
import { chromium, FullConfig } from '@playwright/test';

const DEFAULT_TEST_USER = {
  email: process.env.E2E_TEST_USER_EMAIL || 'e2e-test@hyperdx.io',
  password: process.env.E2E_TEST_USER_PASSWORD || 'TestPassword123!',
} as const;

const API_URL = process.env.E2E_API_URL || 'http://localhost:29000';
const APP_URL = process.env.E2E_APP_URL || 'http://localhost:28081';
const AUTH_FILE = path.join(__dirname, '.auth/user.json');

async function globalSetup(config: FullConfig) {
  console.log('Setting up full-stack E2E environment');
  console.log('  MongoDB: local (auth, teams, persistence)');
  console.log('  ClickHouse: demo instance (telemetry data)');

  // Set timezone
  process.env.TZ = 'America/New_York';

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
  const maxRetries = 30;
  const retryDelay = 1000;
  let apiReady = false;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${API_URL}/health`).catch(() => null);
      if (response?.ok) {
        apiReady = true;
        console.log('  API server is ready');
        break;
      }
    } catch (error) {
      // Continue retrying
    }

    if (i === maxRetries - 1) {
      throw new Error(
        `API server not ready after ${(maxRetries * retryDelay) / 1000} seconds`,
      );
    }

    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }

  if (!apiReady) {
    throw new Error('API server health check failed');
  }

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
      const body = await registerResponse.text();
      // If user/team already exists, that's okay
      if (
        !body.includes('already exists') &&
        !body.includes('duplicate') &&
        !body.includes('teamAlreadyExists')
      ) {
        throw new Error(
          `Registration failed: ${registerResponse.status()} ${body}`,
        );
      }
      console.log('  User/team already exists, continuing');
      console.log(
        '  DEFAULT_SOURCES will NOT be applied (only happens on new team creation)',
      );
      console.log(
        '  Sources must already exist in the database from a previous run',
      );
    } else {
      console.log('  User registered successfully');
      console.log(
        '  DEFAULT_SOURCES should have been applied to this new team',
      );
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
    await page.goto('/');
    await page.waitForLoadState('networkidle');

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
      console.warn('  WARNING: No sources found');
      console.warn(
        '  This may happen if the team already existed from a previous run',
      );
      console.warn('  DEFAULT_SOURCES only applies to newly created teams');
      console.warn('  Tests may fail if sources are not configured');
    } else {
      sources.forEach((source: any) => {
        console.log(`    - ${source.name} (${source.kind})`);
      });
    }

    // Navigate to search page to ensure sources are loaded
    console.log('Navigating to search page');
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Wait for source selector to be ready (indicates sources are loaded)
    await page.waitForSelector('[data-testid="source-settings-menu"]', {
      state: 'visible',
      timeout: 10000,
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
      '  Using demo ClickHouse data for logs, traces, metrics, and K8s',
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
