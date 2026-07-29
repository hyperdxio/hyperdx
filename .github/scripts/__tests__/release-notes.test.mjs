import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  extractSection,
  insertSection,
  PACKAGE_LIST_HEADING,
  parseArgs,
  stripPackageList,
  validateBody,
} from '../release-notes.mjs';

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
  // preamble text through the scaffold path. Compare the preamble only — the
  // committed file also carries every released section.
  const committed = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8');
  const firstSection = committed.indexOf('\n## ');
  const committedHeader =
    firstSection === -1 ? committed : committed.slice(0, firstSection);

  assert.ok(insertSection(null, OPTS).startsWith(committedHeader.trimEnd()));
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

test('stripPackageList removes an existing list so republishing cannot stack copies', () => {
  const withList = `Summary.

### ✨ New Features

- **thing**: yes (#1)

${PACKAGE_LIST_HEADING}

- \`@hyperdx/app\` 2.32.0 → 2.33.0 — [changelog](https://github.com/x)
`;
  const stripped = stripPackageList(withList);

  assert.doesNotMatch(stripped, /Package changelogs/);
  assert.match(stripped, /\*\*thing\*\*: yes/);
  // Idempotent, and a no-op on a body that never had one.
  assert.equal(stripPackageList(stripped), stripped);
  assert.equal(stripPackageList('Just a body.\n'), 'Just a body.\n');
});

test('a reuse round-trip does not accumulate package lists', () => {
  // extract returns the published body including its list; the workflow strips
  // before appending a fresh one. Simulate two republish cycles.
  const append = b =>
    `${b.trimEnd()}\n\n${PACKAGE_LIST_HEADING}\n\n- \`@hyperdx/app\` 1 → 2\n`;
  let body = 'Summary.\n';
  let file = null;
  for (let i = 0; i < 3; i++) {
    file = insertSection(file, {
      ...OPTS,
      body: append(stripPackageList(body)),
    });
    body = extractSection(file, OPTS);
  }
  assert.equal(body.match(/Package changelogs/g).length, 1);
});

test('the app-side marker regex matches the marker this script emits', () => {
  // ChangelogModal.tsx strips markers with its own regex literal. Pin the two
  // together: a marker-format change here must not silently leave the modal
  // rendering raw HTML comments.
  const modal = readFileSync(
    join(REPO_ROOT, 'packages/app/src/components/AppNav/ChangelogModal.tsx'),
    'utf-8',
  );
  const literal = modal.match(/\.replace\(\s*(\/.+?\/[gimsuy]*)\s*,/)?.[1];
  assert.ok(
    literal,
    'could not find the marker-stripping regex in ChangelogModal.tsx',
  );

  const [, pattern, flags] = literal.match(/^\/(.*)\/([gimsuy]*)$/);
  const appRe = new RegExp(pattern, flags);
  const emitted = insertSection(null, OPTS);
  const markerLine = emitted
    .split('\n')
    .find(l => l.startsWith('<!-- hyperdx-release-notes'));

  assert.ok(markerLine, 'insertSection emitted no marker');
  assert.equal(markerLine.replace(appRe, '').trim(), '');
});

test('CLI insert refuses to write "undefined" into a heading when --date is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const changelog = join(dir, 'CHANGELOG.md');
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, 'Body line.\n');

  const res = runCli([
    'insert',
    '--changelog',
    changelog,
    '--body',
    bodyFile,
    '--version',
    '1.0.0',
    '--inputs',
    'aaa111',
  ]);
  assert.equal(res.code, 1);
  assert.equal(existsSync(changelog), false);
});

test('CLI strip-package-list rewrites the body in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const bodyFile = join(dir, 'body.md');
  writeFileSync(
    bodyFile,
    `Summary.\n\n${PACKAGE_LIST_HEADING}\n\n- \`x\` 1 → 2\n`,
  );

  assert.equal(runCli(['strip-package-list', '--body', bodyFile]).code, 0);
  assert.equal(readFileSync(bodyFile, 'utf-8'), 'Summary.\n');
  assert.equal(runCli(['strip-package-list']).code, 1);
});

// --- validateBody corpus ------------------------------------------------------
// These are fail-fast CI checks, not the security boundary (that is
// ChangelogModal.tsx, on the parsed AST). The corpus exists because every
// bypass found in review was in untested inline shell.

test('validateBody accepts realistic release bodies', () => {
  const good = [
    'Summary line.\n\n### 🐛 Bug Fixes\n\n- **fix**: it works now (#1).\n',
    'Summary with an allowed link: [PR](https://github.com/hyperdxio/hyperdx/pull/1).\n',
    'Docs link: [guide](https://docs.hyperdx.io/getting-started).\n',
    'Mixed host casing: [PR](https://GitHub.com/hyperdxio/x).\n',
    // Prose that brushes against the patterns without matching them.
    'Latency dropped to <2ms and the `Map(String, String)` path is fixed.\n',
    'A single --- inside a sentence is fine, and so is a ### heading.\n',
  ];
  for (const body of good) {
    assert.deepEqual(validateBody(body), [], `should accept: ${body}`);
  }
});

test('validateBody rejects every construct that reached the changelog in review', () => {
  const bad = {
    'blank body': '   \n\n',
    'anthropic key': 'Summary sk-ant-api03-AAAAAAAAAAAAAAAA\n',
    'github token': 'Summary ghp_abcdefghijklmnopqrstuvwxyz01\n',
    'release marker': '<!-- hyperdx-release-notes version=1.0.0 inputs=x -->\n',
    'h2 heading': 'Summary.\n\n## v1.2.3 — forged\n',
    'setext underline': 'Forged Release\n---\n',
    'inline image': 'Look ![x](https://evil.example/b.png)\n',
    'reference image': 'Look ![banner][ref]\n',
    'shortcut image': 'Look ![banner]\n',
    'split definition': 'Text [a]\n\n[a]:\n  https://evil.example/p\n',
    'bare autolink': 'See <https://evil.example/x>\n',
    'off-site link': 'See [x](https://evil.example/p)\n',
    'protocol-relative': 'See [x](//evil.example/p)\n',
    'uppercase protocol': 'See [x](HTTPS://evil.example/p)\n',
    'relative link': 'See [x](/local/path)\n',
    'host suffix confusion': 'See [x](https://github.com.evil.example/p)\n',
  };
  for (const [label, body] of Object.entries(bad)) {
    assert.ok(validateBody(body).length > 0, `should reject: ${label}`);
  }
});

test('validateBody rejects an oversized body', () => {
  assert.ok(validateBody('x'.repeat(70_000)).length > 0);
});

test('CLI validate exits 1 with an annotation, 0 on a clean body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const bad = join(dir, 'bad.md');
  const good = join(dir, 'good.md');
  writeFileSync(bad, 'See <https://evil.example/x>\n');
  writeFileSync(good, 'Summary.\n\n### 🐛 Bug Fixes\n\n- **fix**: yes (#1).\n');

  assert.equal(runCli(['validate', '--body', bad]).code, 1);
  assert.equal(runCli(['validate', '--body', good]).code, 0);
  assert.equal(runCli(['validate']).code, 1);
});

test('extractSection treats a maintainer-inserted H2 as a miss, not a truncation', () => {
  // parseChangelog splits on any `## `, so a heading added mid-section would
  // otherwise yield a body truncated at it plus a version-less orphan tail.
  const file = insertSection(null, OPTS);
  const split = file.replace(
    '- **Something shiny**: it gleams (#123)',
    '## Notes from review\n\n- **Something shiny**: it gleams (#123)',
  );
  assert.equal(extractSection(split, OPTS), null);
  // A well-formed multi-section file still extracts fine.
  const twoReleases = insertSection(file, {
    ...OPTS,
    version: '2.34.0',
    inputs: 'newer',
    date: '2026-08-01',
    body: 'Newer body.',
  });
  assert.match(extractSection(twoReleases, OPTS), /Something shiny/);
});

test('CLI extract requires --changelog rather than reporting a cache miss', () => {
  assert.equal(runCli(['extract', '--version', '1.0.0']).code, 1);
});

test('validateBody accepts a bare-host link, matching the render-time allowlist', () => {
  // allowChangelogUrl accepts these, so the CI gate must not be stricter or the
  // publish job reddens for content that would have rendered fine.
  assert.deepEqual(validateBody('See [docs](https://docs.hyperdx.io).\n'), []);
  assert.deepEqual(validateBody('See [gh](https://github.com).\n'), []);
  assert.deepEqual(validateBody('See [q](https://docs.hyperdx.io?a=1).\n'), []);
  // The host must still be the whole host, not a prefix of a longer one.
  assert.ok(validateBody('See [x](https://github.com.evil.tld).\n').length > 0);
});

test('validateBody ignores structure inside code blocks', () => {
  const fenced = [
    'Summary.',
    '',
    'Example config:',
    '',
    '```yaml',
    '---',
    'exporters:',
    '  clickhouse: {}',
    '```',
    '',
    'And a snippet:',
    '',
    '```markdown',
    '## Not a real heading',
    '```',
    '',
    'Indented block:',
    '',
    '    ## also not a heading',
    '',
  ].join('\n');
  assert.deepEqual(validateBody(fenced), []);
});

test('validateBody rejects CommonMark heading forms that a bare ^## misses', () => {
  // Up to three leading spaces, and a tab delimiter, both render as real H2s.
  assert.ok(validateBody('   ## v9.9.9 — Security notice\n').length > 0);
  assert.ok(validateBody('##\tv9.9.9 — Security notice\n').length > 0);
  assert.ok(validateBody(' # Forged H1\n').length > 0);
  // `###` and deeper are the section headings the prompt asks for.
  assert.deepEqual(validateBody('### ✨ New Features\n\n- **x**: y\n'), []);
});

test('insertSection drops a hand-added non-release section instead of orphaning it', () => {
  const file = insertSection(null, OPTS);
  const withOrphan = `${file}\n## Notes from review\n\nSomething a human typed.\n`;
  const out = insertSection(withOrphan, {
    ...OPTS,
    version: '2.34.0',
    inputs: 'newer',
    date: '2026-08-01',
    body: 'Newer body.',
  });

  assert.doesNotMatch(out, /Notes from review/);
  // Real release sections are still preserved.
  assert.match(out, /## v2\.33\.0/);
  assert.match(out, /## v2\.34\.0/);
});
