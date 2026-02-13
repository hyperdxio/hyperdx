#!/usr/bin/env node

/**
 * E2E Test Runner
 *
 * Usage:
 *   yarn test:e2e                    # Run all tests (full-stack mode, default)
 *   yarn test:e2e --local            # Run frontend-only tests
 *   yarn test:e2e --ui               # Open Playwright UI (full-stack)
 *   yarn test:e2e --ui --local       # Open UI (local mode)
 *   yarn test:e2e --debug            # Debug mode (full-stack)
 *   yarn test:e2e --debug --local    # Debug (local mode)
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const useLocal = args.includes('--local');
const useUI = args.includes('--ui');
const useDebug = args.includes('--debug');

// Remove our custom flags from args
const playwrightArgs = args.filter(
  arg => !['--local', '--ui', '--debug'].includes(arg),
);

// Build playwright command
const playwrightCmd = ['playwright', 'test'];

// Add mode flags
if (useUI) {
  playwrightCmd.push('--ui');
}
if (useDebug) {
  playwrightCmd.push('--debug');
}

// Add grep-invert for local mode (exclude @full-stack tests)
if (useLocal) {
  playwrightCmd.push('--grep-invert', '@full-stack');
}

// Add any additional playwright arguments
playwrightCmd.push(...playwrightArgs);

// Set environment variables (Playwright and its webServer children inherit these)
const env = {
  ...process.env,
  ...(!useLocal && { E2E_FULLSTACK: 'true' }),
};

// Full-stack: inject DEFAULT_CONNECTIONS/DEFAULT_SOURCES from fixture so the API gets them
if (!useLocal) {
  const fixturePath = path.join(
    __dirname,
    '../tests/e2e/fixtures/e2e-fixtures.json',
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  env.DEFAULT_CONNECTIONS = JSON.stringify(fixture.connections ?? []);
  env.DEFAULT_SOURCES = JSON.stringify(fixture.sources ?? []);
}

// Run playwright
// eslint-disable-next-line no-console
console.info(`Running: ${playwrightCmd.join(' ')}`);
// eslint-disable-next-line no-console
console.info(`Mode: ${useLocal ? 'Local (frontend only)' : 'Full-stack'}`);

const child = spawn('npx', playwrightCmd, {
  stdio: 'inherit',
  shell: true,
  env,
  cwd: path.join(__dirname, '..'),
});

child.on('exit', code => {
  process.exit(code);
});
