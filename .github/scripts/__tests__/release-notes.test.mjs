import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_LINK_HOSTS,
  extractSection,
  insertSection,
  PACKAGE_LIST_END,
  PACKAGE_LIST_HEADING,
  PACKAGE_LIST_START,
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

test('stripPackageList removes the generated list and keeps text around it', () => {
  const withList = `Summary.

### ✨ New Features

- **thing**: yes (#1)

${PACKAGE_LIST_START}

${PACKAGE_LIST_HEADING}

- \`@hyperdx/app\` 2.32.0 → 2.33.0 — [changelog](https://github.com/x)

${PACKAGE_LIST_END}

A maintainer note written below the generated list.
`;
  const stripped = stripPackageList(withList);

  assert.doesNotMatch(stripped, /Package changelogs/);
  assert.match(stripped, /\*\*thing\*\*: yes/);
  // Slicing to end-of-body would have deleted this.
  assert.match(stripped, /A maintainer note written below/);
  // Idempotent, and a no-op on a body that never had one.
  assert.equal(stripPackageList(stripped), stripped);
  assert.equal(stripPackageList('Just a body.\n'), 'Just a body.\n');
});

test('a reuse round-trip does not accumulate package lists', () => {
  // extract returns the published body including its list; the workflow strips
  // before appending a fresh one. Simulate three republish cycles.
  const append = b =>
    `${b.trimEnd()}\n\n${PACKAGE_LIST_START}\n\n${PACKAGE_LIST_HEADING}\n\n- \`@hyperdx/app\` 1 → 2\n\n${PACKAGE_LIST_END}\n`;
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
    `Summary.\n\n${PACKAGE_LIST_START}\n\n${PACKAGE_LIST_HEADING}\n\n- \`x\` 1 → 2\n\n${PACKAGE_LIST_END}\n`,
  );

  assert.equal(runCli(['strip-package-list', '--body', bodyFile]).code, 0);
  assert.equal(readFileSync(bodyFile, 'utf-8'), 'Summary.\n');
  assert.equal(runCli(['strip-package-list']).code, 1);
});

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
  // Each case asserts the message its own rule produces. Asserting only
  // `length > 0` lets a regression that disables one rule stay green whenever
  // another rule happens to fire on the same fixture.
  const bad = {
    'blank body': ['   \n\n', /is blank/],
    'anthropic key': [
      'Summary sk-ant-api03-AAAAAAAAAAAAAAAA\n',
      /shaped like a credential/,
    ],
    'github token': [
      'Summary ghp_abcdefghijklmnopqrstuvwxyz01\n',
      /shaped like a credential/,
    ],
    'release marker': [
      '<!-- hyperdx-release-notes version=1.0.0 inputs=x -->\n',
      /release-notes marker/,
    ],
    'package-list marker': [
      `Summary.\n\n${PACKAGE_LIST_START}\n`,
      /package-list marker/,
    ],
    'h2 heading': ['Summary.\n\n## v1.2.3 — forged\n', /H2 heading/],
    'h1 heading': ['# Forged H1\n\nSummary.\n', /H1 heading/],
    'setext underline': ['Forged Release\n---\n', /setext heading underline/],
    'inline image': [
      'Look ![x](https://evil.example/b.png)\n',
      /contains an image/,
    ],
    'reference image': ['Look ![banner][ref]\n', /contains an image/],
    'shortcut image': ['Look ![banner]\n', /contains an image/],
    'split definition': [
      'Text [a]\n\n[a]:\n  https://evil.example/p\n',
      /reference-style links/,
    ],
    'bare autolink': ['See <https://evil.example/x>\n', /contains an autolink/],
    'raw html': ['Look <img src="https://x.example/b.png">\n', /raw HTML/],
    'off-site link': [
      'See [x](https://evil.example/p)\n',
      /Disallowed link target: https:\/\/evil\.example\/p/,
    ],
    'protocol-relative': [
      'See [x](//evil.example/p)\n',
      /Disallowed link target: \/\/evil\.example\/p/,
    ],
    'uppercase protocol': [
      'See [x](HTTPS://evil.example/p)\n',
      /Disallowed link target/,
    ],
    'relative link': [
      'See [x](/local/path)\n',
      /Disallowed link target: \/local\/path/,
    ],
    'host suffix confusion': [
      'See [x](https://github.com.evil.example/p)\n',
      /Disallowed link target/,
    ],
    'bare url in prose': [
      'Read more at https://evil.example/p for details.\n',
      /Disallowed URL in prose: https:\/\/evil\.example\/p/,
    ],
  };
  for (const [label, [body, expected]] of Object.entries(bad)) {
    const errors = validateBody(body);
    assert.ok(errors.length > 0, `should reject: ${label}`);
    assert.match(errors.join('\n'), expected, `wrong reason for: ${label}`);
  }
});

test('validateBody does not fire on prose a code span or fence makes literal', () => {
  // These reddened the publish job while the release shipped with no changelog
  // section — the worst of both outcomes for a legitimate body.
  const good = [
    'Summary.\n\n```yaml\n# a comment, not a heading\nkey: value\n```\n',
    'Wrap the value in `<input>` and it works.\n',
    'Use `# heading` syntax in the template.\n',
    'The `<a href="x">` form is no longer emitted.\n',
    'Copy from `https://clickhouse.com/docs` if you need the upstream page.\n',
  ];
  for (const body of good) {
    assert.deepEqual(validateBody(body), [], `should accept: ${body}`);
  }
});

test('validateBody agrees with the render-time allowlist on parsed-URL forms', () => {
  // A prefix regex rejected these while allowChangelogUrl renders them, so the
  // publish job reddened for content that was fine. Same algorithm now.
  for (const url of [
    'https://github.com:443/hyperdxio/hyperdx',
    'https://user@github.com/hyperdxio/hyperdx',
    'https://docs.hyperdx.io',
    'https://GitHub.com/x',
  ]) {
    assert.deepEqual(validateBody(`See [x](${url}).\n`), [], `accept: ${url}`);
  }
});

test('the render-time host allowlist matches this script’s', () => {
  // Two languages, one policy. Pinned here so a host added to one side cannot
  // silently make the CI gate stricter (a red release) or looser (a phishing
  // link that only the modal blocks).
  const modal = readFileSync(
    join(REPO_ROOT, 'packages/app/src/components/AppNav/ChangelogModal.tsx'),
    'utf-8',
  );
  const literal = modal.match(
    /ALLOWED_LINK_HOSTS = new Set\(\[([^\]]*)\]\)/,
  )?.[1];
  assert.ok(literal, 'could not find ALLOWED_LINK_HOSTS in ChangelogModal.tsx');
  const appHosts = [...literal.matchAll(/'([^']+)'/g)].map(m => m[1]);

  assert.deepEqual(appHosts.sort(), [...ALLOWED_LINK_HOSTS].sort());
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

test('validateBody ignores setext and definitions inside code blocks', () => {
  // A fenced YAML example opening `---` renders fine and must not fail the job.
  const fenced = [
    'Summary.',
    '',
    '```yaml',
    '---',
    'exporters:',
    '  clickhouse: {}',
    '```',
    '',
    'Indented block:',
    '',
    '    ---',
    '',
  ].join('\n');
  assert.deepEqual(validateBody(fenced), []);
});

test('validateBody rejects a fenced ## because parseChangelog is not fence-aware', () => {
  // The splice would treat it as a section boundary and cut the section in two,
  // so validate has to agree with the parser rather than with CommonMark here.
  const fenced = 'Summary.\n\n```markdown\n## Not a real heading\n```\n';
  assert.ok(validateBody(fenced).length > 0);
});

test('validateBody rejects CommonMark heading forms that a bare ^## misses', () => {
  // Up to three leading spaces, and a tab delimiter, both render as real H2s.
  assert.ok(validateBody('   ## v9.9.9 — Security notice\n').length > 0);
  assert.ok(validateBody('##\tv9.9.9 — Security notice\n').length > 0);
  assert.ok(validateBody(' # Forged H1\n').length > 0);
  // `###` and deeper are the section headings the prompt asks for.
  assert.deepEqual(validateBody('### ✨ New Features\n\n- **x**: y\n'), []);
});

test('insertSection drops a non-release section above every release', () => {
  const file = insertSection(null, OPTS);
  const withOrphan = file.replace(
    '## v2.33.0',
    '## Notes from review\n\nSomething a human typed.\n\n## v2.33.0',
  );
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

test('insertSection refuses to splice over a non-release heading inside published notes', () => {
  // The tail of a release split by a hand-added `## ` carries real release
  // notes. Dropping it would delete them from the committed changelog with
  // nothing in the run log to show for it.
  const file = insertSection(null, OPTS);
  const split = `${file}\n## Notes from review\n\nSomething a human typed.\n`;

  assert.throws(
    () =>
      insertSection(split, {
        ...OPTS,
        version: '2.34.0',
        inputs: 'newer',
        date: '2026-08-01',
        body: 'Newer body.',
      }),
    /Notes from review/,
  );
});

test('stripPackageList leaves a half-deleted marker pair alone', () => {
  const list = `${PACKAGE_LIST_HEADING}\n\n- \`@hyperdx/app\` 1 → 2\n`;
  const note = 'A maintainer note written below the generated list.';

  // End marker gone: there is no safe cut, so nothing is removed and the
  // leftover start marker makes validateBody treat the body as a cache miss.
  const endGone = `Summary.\n\n${PACKAGE_LIST_START}\n\n${list}\n${note}\n`;
  assert.equal(stripPackageList(endGone), endGone);
  assert.match(
    validateBody(stripPackageList(endGone)).join('\n'),
    /package-list marker/,
  );

  // Start marker gone: the heading is where the generated block begins.
  const startGone = `Summary.\n\n${list}\n${PACKAGE_LIST_END}\n\n${note}\n`;
  const stripped = stripPackageList(startGone);
  assert.doesNotMatch(stripped, /Package changelogs/);
  assert.match(stripped, /Summary\./);
  assert.match(stripped, /A maintainer note written below/);
  assert.deepEqual(validateBody(stripped), []);
});

test('CLI latest-version falls back to the heading when the marker is gone', () => {
  // Deleting the marker is the one edit the design anticipates. Exiting 2 here
  // made the caller hand the already-released section to the generator as this
  // release's prior text.
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const changelog = join(dir, 'CHANGELOG.md');
  writeFileSync(
    changelog,
    insertSection(null, OPTS).replace(
      /<!-- hyperdx-release-notes[^>]*-->\n/,
      '',
    ),
  );

  const res = runCli(['latest-version', '--changelog', changelog]);
  assert.equal(res.code, 0);
  assert.equal(res.stdout, '2.33.0');
});

test('validateBody rejects raw HTML that GitHub would render', () => {
  // react-markdown ignores raw HTML, but the committed CHANGELOG.md is rendered
  // by GitHub with these allowed, and <img src> carries no `](`.
  for (const body of [
    'Look <img src="https://evil.example/beacon.png">\n',
    'Click <a href="https://evil.example/phish">here</a>\n',
    'Summary <script>alert(1)</script>\n',
    'Summary <iframe src="https://evil.example"></iframe>\n',
  ]) {
    assert.ok(validateBody(body).length > 0, `should reject: ${body}`);
  }
  // Prose using angle brackets is not HTML and must still pass.
  assert.deepEqual(
    validateBody('Latency is <2ms and `Map<string, string>` works.\n'),
    [],
  );
});

test('any body validateBody accepts survives a splice round-trip byte-for-byte', () => {
  // The invariant that ties the two halves together: if validate says yes, the
  // splice must not reshape it. This is what the fenced-`##` case violated.
  const accepted = [
    'Summary line.\n\n### 🐛 Bug Fixes\n\n- **fix**: yes (#1).\n',
    'Summary.\n\n```yaml\n---\nkey: value\n```\n\n### ✨ New Features\n\n- **x**: y\n',
    'Summary with [a link](https://github.com/hyperdxio/hyperdx/pull/1).\n',
    'Summary.\n\n### 🔧 Improvements\n\n- **a**: one\n- **b**: two\n',
  ];
  for (const body of accepted) {
    assert.deepEqual(validateBody(body), [], `precondition: ${body}`);
    const file = insertSection(null, { ...OPTS, body });
    assert.equal(
      extractSection(file, OPTS).trim(),
      body.trim(),
      `round-trip changed the body: ${body}`,
    );
  }
});

test('CLI latest-version reports the newest section, or exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const changelog = join(dir, 'CHANGELOG.md');
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, 'Body.\n');

  assert.equal(runCli(['latest-version', '--changelog', changelog]).code, 2);
  runCli([
    'insert',
    '--changelog',
    changelog,
    '--body',
    bodyFile,
    '--version',
    '2.33.0',
    '--inputs',
    'a',
    '--date',
    '2026-07-01',
  ]);
  runCli([
    'insert',
    '--changelog',
    changelog,
    '--body',
    bodyFile,
    '--version',
    '2.34.0',
    '--inputs',
    'b',
    '--date',
    '2026-07-29',
  ]);

  assert.equal(
    runCli(['latest-version', '--changelog', changelog]).stdout,
    '2.34.0',
  );
});
