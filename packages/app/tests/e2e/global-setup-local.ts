/**
 * Global setup for local E2E mode
 *
 * Local mode only needs to seed ClickHouse (no MongoDB, no auth)
 */

import { FullConfig } from '@playwright/test';

import { seedClickHouse } from './seed-clickhouse';

async function globalSetupLocal(_config: FullConfig): Promise<void> {
  console.log('Setting up local E2E environment (seeding ClickHouse)');
  process.env.TZ = 'America/New_York';

  await seedClickHouse();

  console.log('Local E2E setup complete');
}

export default globalSetupLocal;
