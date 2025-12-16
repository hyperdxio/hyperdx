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

const MOCK_USER = {
  email: 'e2e-test@hyperdx.io',
  password: 'TestPassword123!',
};

const API_URL = 'http://localhost:29000';
const APP_URL = 'http://localhost:28081';
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

  // Wait a bit for servers to be fully ready
  await new Promise(resolve => setTimeout(resolve, 5000));

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
    const sourcesResponse = await page.request.get(`${API_URL}/sources`);
    if (sourcesResponse.ok()) {
      const sources = await sourcesResponse.json();
      console.log(`  Found ${sources.length} default sources`);
      if (sources.length === 0) {
        console.error('  No sources found - check DEFAULT_SOURCES env var');
        throw new Error(
          'No sources created - DEFAULT_SOURCES may not be set or team already existed',
        );
      } else {
        sources.forEach((source: any) => {
          console.log(`    - ${source.name} (${source.kind})`);
        });
      }
    } else {
      const errorText = await sourcesResponse.text();
      console.error(
        `  Failed to fetch sources: ${sourcesResponse.status} ${errorText}`,
      );
      throw new Error('Failed to fetch sources');
    }

    // Navigate to search page to ensure sources are loaded
    console.log('Navigating to search page');
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

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
