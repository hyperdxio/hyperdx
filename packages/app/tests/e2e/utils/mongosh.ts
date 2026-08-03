import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Run a mongosh script against the e2e MongoDB container by piping the script
 * through stdin. Using stdin (rather than `--eval "<...>"`) avoids having to
 * escape quotes in the script body, so callers can pass multi-line JavaScript
 * with string literals verbatim.
 *
 * Used to set fields that only a backend job writes in normal operation
 * (`Alert.executionErrors`, `Dashboard.provisioned`), so a test can reach that
 * state without running the job.
 *
 * `execFileSync` with an argument array rather than a shell string: the project
 * slug comes from an env var, and no shell means nothing in it can be read as a
 * metacharacter.
 *
 * Throws if the docker-compose file can't be found (meaning we're not running
 * in the expected Docker-backed e2e environment).
 */
export function runMongoshScript(script: string): string {
  const dockerComposeFile = path.join(__dirname, '..', 'docker-compose.yml');
  if (!fs.existsSync(dockerComposeFile)) {
    throw new Error(
      `docker-compose.yml not found at ${dockerComposeFile} — e2e Docker stack unavailable`,
    );
  }

  const e2eSlot = process.env.HDX_E2E_SLOT || '0';

  return execFileSync(
    'docker',
    [
      'compose',
      '-p',
      `e2e-${e2eSlot}`,
      '-f',
      dockerComposeFile,
      'exec',
      '-T',
      'db',
      'mongosh',
      '--quiet',
    ],
    {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: script,
    },
  );
}
