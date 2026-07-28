import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractSection, insertSection } from '../release-notes.mjs';

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
