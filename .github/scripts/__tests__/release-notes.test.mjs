import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { extractSection, insertSection, parseArgs } from '../release-notes.mjs';

const SCRIPT = fileURLToPath(new URL('../release-notes.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const BODY = `Fresh release summary.

### ✨ New Features

- **Something shiny**: it gleams (#123)`;

const OPTS = {
  version: '2.33.0',
  inputs: 'abc123def456',
  date: '2026-07-28',
  body: BODY,
};

test('insertSection creates the file scaffold when content is null', () => {
  const out = insertSection(null, OPTS);
  assert.match(out, /^# HyperDX Changelog/);
  assert.match(out, /## v2\.33\.0 — 2026-07-28/);
  assert.match(
    out,
    /<!-- hyperdx-release-notes version=2\.33\.0 inputs=abc123def456 -->/,
  );
  assert.match(out, /Something shiny/);
  assert.ok(out.endsWith('\n'));
});

test('insertSection scaffolds the header for a blank file too', () => {
  // release.yml's capture step can leave a zero-byte CHANGELOG.md behind.
  for (const blank of ['', '\n', '   \n']) {
    assert.match(insertSection(blank, OPTS), /^# HyperDX Changelog/);
  }
});

test('insertSection prepends above existing sections without touching them', () => {
  const existing = insertSection(null, {
    ...OPTS,
    version: '2.32.0',
    inputs: 'oldhash000000',
    date: '2026-07-01',
    body: 'Old release body.',
  });
  const out = insertSection(existing, OPTS);
  const idxNew = out.indexOf('## v2.33.0');
  const idxOld = out.indexOf('## v2.32.0');
  assert.ok(idxNew !== -1 && idxOld !== -1 && idxNew < idxOld);
  assert.match(out, /Old release body\./);
});

test('insertSection replaces an existing section for the same version', () => {
  const first = insertSection(null, OPTS);
  const out = insertSection(first, {
    ...OPTS,
    inputs: 'newhash999999',
    body: 'Regenerated body.',
  });
  assert.equal(out.match(/## v2\.33\.0/g).length, 1);
  assert.match(out, /Regenerated body\./);
  assert.doesNotMatch(out, /Something shiny/);
  assert.match(out, /inputs=newhash999999/);
});

test('extractSection returns the body when version and inputs match', () => {
  const content = insertSection(null, OPTS);
  assert.equal(extractSection(content, OPTS).trim(), BODY.trim());
});

test('extractSection with inputs omitted matches by version alone', () => {
  const content = insertSection(null, OPTS);
  assert.equal(
    extractSection(content, { version: '2.33.0' }).trim(),
    BODY.trim(),
  );
  assert.equal(extractSection(content, { version: '9.9.9' }), null);
});

test('extractSection returns null on inputs-hash mismatch, missing version, or null content', () => {
  const content = insertSection(null, OPTS);
  assert.equal(
    extractSection(content, { version: '2.33.0', inputs: 'different' }),
    null,
  );
  assert.equal(
    extractSection(content, { version: '9.9.9', inputs: OPTS.inputs }),
    null,
  );
  assert.equal(extractSection(null, OPTS), null);
});

test('extractSection tolerates prettier reflowing the blank lines around the marker', () => {
  // prettier reformats CHANGELOG.md whenever a maintainer edits it locally
  // (lint-staged), so the marker's position within the section is not fixed.
  const reflowed = `# HyperDX Changelog

## v2.33.0 — 2026-07-28

<!-- hyperdx-release-notes version=2.33.0 inputs=abc123def456 -->

${BODY}
`;
  assert.equal(extractSection(reflowed, OPTS).trim(), BODY.trim());
  assert.doesNotMatch(extractSection(reflowed, OPTS), /hyperdx-release-notes/);
});

test('round-trip: extract then insert preserves a human-edited body verbatim', () => {
  const edited = insertSection(null, {
    ...OPTS,
    body: 'A human rewrote this entirely.\n\n### 🐛 Bug Fixes\n\n- **kept**: yes',
  });
  const body = extractSection(edited, OPTS);
  const roundTripped = insertSection(insertSection(null, OPTS), {
    ...OPTS,
    body,
  });
  assert.match(roundTripped, /A human rewrote this entirely\./);
  assert.doesNotMatch(roundTripped, /Something shiny/);
});

test('insertSection replaces a section whose marker a maintainer deleted', () => {
  // Without matching on the heading too, the marker-less section parses as
  // version:null, survives the filter, and the file grows a permanent duplicate.
  const withMarker = insertSection(null, OPTS);
  const markerless = withMarker.replace(
    /<!-- hyperdx-release-notes[^>]*-->\n/,
    '',
  );
  const out = insertSection(markerless, { ...OPTS, body: 'Regenerated.' });

  assert.equal(out.match(/## v2\.33\.0/g).length, 1);
  assert.match(out, /Regenerated\./);
  assert.doesNotMatch(out, /Something shiny/);
});

test('extractSection --latest returns the newest section regardless of version', () => {
  const older = insertSection(null, {
    ...OPTS,
    version: '2.32.0',
    inputs: 'old',
    date: '2026-07-01',
    body: 'Older body.',
  });
  const content = insertSection(older, OPTS);

  assert.match(extractSection(content, { latest: true }), /Something shiny/);
  // A bump-level change means the version lookup misses where --latest hits.
  assert.equal(extractSection(content, { version: '2.34.0' }), null);
  assert.equal(extractSection(null, { latest: true }), null);
});

test('the HEADER scaffold stays in sync with the committed root CHANGELOG.md', () => {
  // Enforced here rather than by a comment: prettier reflows CHANGELOG.md
  // whenever a maintainer edits it, and drift would silently resurrect stale
  // preamble text through the scaffold path.
  const committed = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8');
  assert.ok(insertSection(null, OPTS).startsWith(committed.trimEnd()));
});

test('parseArgs handles value flags, boolean flags, and rejects malformed input', () => {
  assert.deepEqual(parseArgs(['--changelog', 'a.md', '--version', '1.0.0']), {
    changelog: 'a.md',
    version: '1.0.0',
  });
  assert.deepEqual(parseArgs(['--latest', '--changelog', 'a.md']), {
    latest: true,
    changelog: 'a.md',
  });
  assert.throws(() => parseArgs(['notaflag']), /Bad argument/);
  assert.throws(() => parseArgs(['--version']), /Bad argument/);
});

// --- CLI entrypoint: what release.yml actually invokes -----------------------

function runCli(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '' };
  }
}

test('CLI insert writes the file, and extract round-trips it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const changelog = join(dir, 'CHANGELOG.md');
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, 'Body line.\n');

  assert.equal(
    runCli([
      'insert',
      '--changelog',
      changelog,
      '--body',
      bodyFile,
      '--version',
      '1.0.0',
      '--inputs',
      'aaa111',
      '--date',
      '2026-07-28',
    ]).code,
    0,
  );
  assert.equal(
    readFileSync(changelog, 'utf-8'),
    insertSection(null, {
      version: '1.0.0',
      inputs: 'aaa111',
      date: '2026-07-28',
      body: 'Body line.',
    }),
  );

  const hit = runCli([
    'extract',
    '--changelog',
    changelog,
    '--version',
    '1.0.0',
    '--inputs',
    'aaa111',
  ]);
  assert.equal(hit.code, 0);
  assert.equal(hit.stdout, 'Body line.\n');
});

test('CLI extract exits 2 on a miss, a missing file, and an emptied body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const changelog = join(dir, 'CHANGELOG.md');
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, 'Body line.\n');
  runCli([
    'insert',
    '--changelog',
    changelog,
    '--body',
    bodyFile,
    '--version',
    '1.0.0',
    '--inputs',
    'aaa111',
    '--date',
    '2026-07-28',
  ]);

  // Wrong hash, wrong version, and a file that does not exist at all.
  assert.equal(
    runCli([
      'extract',
      '--changelog',
      changelog,
      '--version',
      '1.0.0',
      '--inputs',
      'WRONG',
    ]).code,
    2,
  );
  assert.equal(
    runCli(['extract', '--changelog', changelog, '--version', '9.9.9']).code,
    2,
  );
  assert.equal(
    runCli([
      'extract',
      '--changelog',
      join(dir, 'nope.md'),
      '--version',
      '1.0.0',
    ]).code,
    2,
  );

  // A maintainer who empties the body must not get an empty section
  // republished by the unvalidated reuse path.
  writeFileSync(
    changelog,
    readFileSync(changelog, 'utf-8').replace('Body line.\n', ''),
  );
  assert.equal(
    runCli([
      'extract',
      '--changelog',
      changelog,
      '--version',
      '1.0.0',
      '--inputs',
      'aaa111',
    ]).code,
    2,
  );
});

test('CLI exits 1 on an unknown command', () => {
  assert.equal(runCli(['bogus', '--changelog', 'x.md']).code, 1);
});
