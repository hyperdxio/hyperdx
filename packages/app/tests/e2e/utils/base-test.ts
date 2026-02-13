import fs from 'fs';
import path from 'path';
import { expect, test as base } from '@playwright/test';

// Single source of truth: e2e-fixtures.json (connections/sources). API gets them via run-api-with-fixtures.js.
const E2E_FIXTURES_PATH = path.join(__dirname, '../fixtures/e2e-fixtures.json');
function loadE2EFixtures(): { connections: unknown[]; sources: unknown[] } {
  try {
    const raw = fs.readFileSync(E2E_FIXTURES_PATH, 'utf8');
    const fixture = JSON.parse(raw);
    return {
      connections: Array.isArray(fixture.connections)
        ? fixture.connections
        : [],
      sources: Array.isArray(fixture.sources) ? fixture.sources : [],
    };
  } catch {
    return { connections: [], sources: [] };
  }
}
const e2eFixtures = loadE2EFixtures();

// Extend the base test to automatically handle Tanstack devtools
export const test = base.extend({
  page: async ({ page }, fn) => {
    // Note: page.addInitScript runs in the browser context, which cannot access Node.js
    // environment variables directly. We pass USE_FULLSTACK and connection/sources from
    // e2e-fixtures.json so local mode uses the same data as full-stack.
    await page.addInitScript(
      (arg: unknown[]) => {
        const [connections, sources] = arg;
        window.localStorage.setItem('TanstackQueryDevtools.open', 'false');
        window.sessionStorage.setItem(
          'connections',
          JSON.stringify(connections),
        );
        window.localStorage.setItem(
          'hdx-local-source',
          JSON.stringify(sources),
        );
      },
      [e2eFixtures.connections, e2eFixtures.sources],
    );
    await fn(page);
  },
});

export { expect };
