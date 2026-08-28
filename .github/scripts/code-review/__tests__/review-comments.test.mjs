// review-comments.cjs decides where every review finding lands: inline on a diff line, or
// in the summary. Both failure directions are silent -- a bad line map drops findings into
// the summary that should have been inline, and a bad fingerprint reposts the same comment
// on every push. Neither shows up as a workflow failure, so they are pinned here.
//
// Run by claude-code-review.yml before the (expensive) review step.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const helpers = require('../review-comments.cjs');

/** Two files, three hunks, including a pure deletion and an added file. */
const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@ export function a() {
   const keep = 1;
-  const gone = 2;
+  const added = 3;
+  const alsoAdded = 4;
   return keep;
@@ -40,2 +41,2 @@ export function b() {
-  old();
+  neu();
 }
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

test('parseCommentableLines counts added and context lines, not removals', () => {
  const map = helpers.parseCommentableLines(DIFF);

  // Hunk starts at new-line 10: context(10), added(11), added(12), context(13).
  // The removed line consumes no post-image number.
  assert.deepEqual(
    [...map.get('src/a.ts')].sort((x, y) => x - y),
    [10, 11, 12, 13, 41, 42],
  );
  assert.deepEqual(
    [...map.get('src/b.ts')].sort((x, y) => x - y),
    [1, 2],
  );
});

test('parseCommentableLines does not create an entry for /dev/null', () => {
  const map = helpers.parseCommentableLines(DIFF);
  assert.equal(map.has('/dev/null'), false);
  assert.equal(map.size, 2);
});

test('anchors findings on diff lines and routes the rest to the summary', () => {
  const findings = [
    {
      file: 'src/a.ts',
      line: 11,
      severity: 'major',
      title: 'on an added line',
      body: 'fix',
    },
    {
      file: 'src/a.ts',
      line: 999,
      severity: 'major',
      title: 'line not in any hunk',
      body: 'fix',
    },
    {
      file: 'src/untouched.ts',
      line: 5,
      severity: 'minor',
      title: 'file not in diff',
      body: 'fix',
    },
    {
      file: 'src/a.ts',
      severity: 'minor',
      title: 'no line at all',
      body: 'fix',
    },
  ];
  const { inline, unanchored } = helpers.buildInlineComments({
    findings,
    diffText: DIFF,
    existingComments: [],
  });

  assert.equal(inline.length, 1);
  assert.equal(inline[0].comment.path, 'src/a.ts');
  assert.equal(inline[0].comment.line, 11);
  assert.equal(inline[0].comment.side, 'RIGHT');
  // The originating finding rides along so a rejected anchor can fall back to the
  // summary with its real content instead of a stub.
  assert.equal(inline[0].finding.title, 'on an added line');
  assert.equal(inline[0].finding.severity, 'major');

  // Findings about files the diff never touched are a large slice of the useful output --
  // they must be surfaced in the summary, never dropped.
  assert.equal(unanchored.length, 3);
  assert.deepEqual(
    unanchored.map(f => f.title),
    ['line not in any hunk', 'file not in diff', 'no line at all'],
  );
});

test('fingerprint survives a reworded body but changes with path or title', () => {
  const base = {
    file: 'src/a.ts',
    title: 'The  Thing   Is Broken',
    body: 'one',
  };
  assert.equal(
    helpers.fingerprint(base),
    helpers.fingerprint({
      ...base,
      body: 'a completely different fix sentence',
    }),
    'body rewording must not repost the finding',
  );
  assert.equal(
    helpers.fingerprint(base),
    helpers.fingerprint({ ...base, title: 'the thing is broken' }),
    'whitespace and case are normalized',
  );
  assert.notEqual(
    helpers.fingerprint(base),
    helpers.fingerprint({ ...base, file: 'src/b.ts' }),
  );
  assert.notEqual(
    helpers.fingerprint(base),
    helpers.fingerprint({ ...base, title: 'other' }),
  );
});

test('skips findings already posted, matched by fingerprint', () => {
  const finding = {
    file: 'src/a.ts',
    line: 11,
    severity: 'major',
    title: 'already said',
    body: 'fix',
  };
  // Take the marker from commentBody rather than hand-writing the format: a hand-written
  // copy keeps passing after the real marker format changes, and then nothing is deduped.
  const previous = { body: helpers.commentBody(finding) };

  const { inline, unanchored, skipped } = helpers.buildInlineComments({
    findings: [finding],
    diffText: DIFF,
    existingComments: [previous],
  });
  assert.deepEqual(inline, []);
  assert.deepEqual(unanchored, []);
  assert.equal(skipped.length, 1);
});

test('duplicate findings within one run collapse to a single comment', () => {
  const f = {
    file: 'src/a.ts',
    line: 11,
    severity: 'major',
    title: 'same thing',
    body: 'fix',
  };
  const { inline } = helpers.buildInlineComments({
    findings: [f, { ...f, line: 12, body: 'worded differently' }],
    diffText: DIFF,
    existingComments: [],
  });
  assert.equal(inline.length, 1);
});

// Do NOT hand-copy the gate's regex here. A duplicate passes while the workflow's own
// parser silently stops recognizing the marker -- exactly the failure this file exists to
// catch. Lift the `RE=` line out of the workflow and run the real `sed`.
const WORKFLOW = fileURLToPath(
  new URL('../../../workflows/claude-code-review.yml', import.meta.url),
);

function gateParse(body) {
  const line = readFileSync(WORKFLOW, 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith('RE='));
  assert.ok(line, 'could not find the gate RE= line in the workflow');
  const expr = line.trim().slice(3).replace(/^'|'$/g, '');
  const run = group =>
    execFileSync('sed', ['-n', `${expr}\\${group}/p`], {
      input: body,
      encoding: 'utf-8',
    }).split('\n')[0];
  return { diff: run(1), prompt: run(2) };
}

const HASH = 'a'.repeat(64);

test('a healthy run stamps a marker the gate can parse', () => {
  const body = helpers.renderSummary({
    findings: [
      { file: 'src/a.ts', line: 11, severity: 'major', title: 't', body: 'b' },
    ],
    unanchored: [],
    posted: 1,
    healthy: true,
    diffHash: HASH,
    promptHash: HASH,
  });
  const parsed = gateParse(body);
  assert.equal(
    parsed.diff,
    HASH,
    "the workflow's own sed must read the marker we wrote",
  );
  assert.equal(parsed.prompt, HASH);
  assert.ok(
    body.startsWith('<!-- claude-code-review -->'),
    'sticky marker must be first',
  );
});

test('an unhealthy run stamps NO parseable marker, so the gate fails open', () => {
  // This is the whole safety property: without it, one broken run caches a zero-finding
  // review against this diff hash and the diff is never reviewed again.
  const body = helpers.renderSummary({
    findings: [],
    unanchored: [],
    posted: 0,
    healthy: false,
    reason: 'no structured output',
    diffHash: HASH,
    promptHash: HASH,
  });
  assert.equal(
    gateParse(body).diff,
    '',
    'gate must find no hash, so it re-reviews',
  );
  assert.match(body, /did not complete/);
});

test('minor findings are folded, not dropped', () => {
  // Measured on the eval set: minor-severity findings carry 29-57% of everything a human
  // independently flagged, so filtering them costs about half the recall.
  const unanchored = [
    { file: 'src/x.ts', severity: 'minor', title: 'small one', body: 'fix' },
    { file: 'src/y.ts', severity: 'major', title: 'big one', body: 'fix' },
  ];
  const body = helpers.renderSummary({
    findings: unanchored,
    unanchored,
    posted: 0,
    healthy: true,
    diffHash: HASH,
    promptHash: HASH,
  });
  assert.match(body, /<details><summary>1 minor<\/summary>/);
  assert.match(body, /small one/, 'folded, but present');
  const detailsAt = body.indexOf('<details>');
  assert.ok(
    body.indexOf('big one') < detailsAt,
    'non-minor findings render above the fold',
  );
});

test('a clean diff produces an explicit all-clear', () => {
  const body = helpers.renderSummary({
    findings: [],
    unanchored: [],
    posted: 0,
    healthy: true,
    diffHash: HASH,
    promptHash: HASH,
  });
  assert.match(body, /No issues found/);
  assert.equal(
    gateParse(body).diff,
    HASH,
    'a clean review is still a completed review',
  );
});

test('an unrecognized severity degrades to minor rather than throwing', () => {
  const f = {
    file: 'src/a.ts',
    line: 11,
    severity: 'catastrophic',
    title: 't',
    body: 'b',
  };
  assert.equal(helpers.severityOf(f), 'minor');
  const { inline } = helpers.buildInlineComments({
    findings: [f],
    diffText: DIFF,
    existingComments: [],
  });
  assert.match(inline[0].comment.body, /\*\*minor\*\*/);
});

test('a deleted file does not leak its hunk onto the previously seen file', () => {
  // `+++ /dev/null` must clear the target. Otherwise the deletion hunk's line numbers are
  // attributed to whatever file was parsed before it.
  const diff = [
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-a',
    '-b',
    'diff --git a/new.ts b/new.ts',
    '--- /dev/null',
    '+++ b/new.ts',
    '@@ -0,0 +1,2 @@',
    '+x',
    '+y',
    '',
  ].join('\n');
  const map = helpers.parseCommentableLines(diff);
  assert.deepEqual([...map.keys()], ['new.ts']);
  assert.deepEqual([...map.get('new.ts')].sort(), [1, 2]);
});

test('diff content that looks like a file or hunk header is treated as content', () => {
  // An added line whose text is `++ b/x` renders as `+++ b/x`; a naive parser resets state
  // on it and mis-routes every later anchor. Hunk lengths are consumed to prevent that.
  const diff = [
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,1 +1,3 @@',
    ' context',
    '+++ b/evil.ts',
    '+@@ -9,9 +9,9 @@',
    '',
  ].join('\n');
  const map = helpers.parseCommentableLines(diff);
  assert.deepEqual([...map.keys()], ['a.ts'], 'no phantom file');
  assert.deepEqual([...map.get('a.ts')].sort(), [1, 2, 3]);
});

test('findings with no file do not collide with each other', () => {
  const a = { title: 'first', body: 'x' };
  const b = { title: 'second', body: 'x' };
  assert.notEqual(helpers.fingerprint(a), helpers.fingerprint(b));
});

test('the summary does not claim findings were unanchorable when they were already posted', () => {
  // posted:0 with nothing unanchored means every finding was deduped against an earlier
  // push. Saying "none could be anchored" and then listing nothing is misleading.
  const body = helpers.renderSummary({
    findings: [
      { file: 'src/a.ts', line: 11, severity: 'major', title: 't', body: 'b' },
    ],
    unanchored: [],
    posted: 0,
    healthy: true,
    diffHash: HASH,
    promptHash: HASH,
  });
  assert.match(body, /Already reported on an earlier push/);
  assert.doesNotMatch(body, /listed below/);
});

test('the summary counts both delivered and listed findings when it does both', () => {
  const body = helpers.renderSummary({
    findings: [
      { file: 'a', line: 1, severity: 'major', title: 'x', body: 'y' },
      { file: 'b', severity: 'major', title: 'z', body: 'w' },
    ],
    unanchored: [{ file: 'b', severity: 'major', title: 'z', body: 'w' }],
    posted: 1,
    healthy: true,
    diffHash: HASH,
    promptHash: HASH,
  });
  assert.match(body, /1 posted as inline comment\(s\)/);
  assert.match(body, /1 listed below/);
});

test("the sticky marker matches the workflow's body-includes", () => {
  // find-comment locates the comment to update by substring. If this marker and the
  // workflow's `body-includes` drift apart, every push posts a NEW sticky comment instead
  // of updating the old one, and the gate stops finding prior state. Same class of silent
  // duplication as the gate regex, so it gets the same treatment: read the real value.
  const wf = readFileSync(WORKFLOW, 'utf8');
  const line = wf.split('\n').find(l => l.trim().startsWith('body-includes:'));
  assert.ok(line, 'could not find body-includes in the workflow');
  const marker = line
    .split('body-includes:')[1]
    .trim()
    .replace(/^['"]|['"]$/g, '');

  for (const healthy of [true, false]) {
    const body = helpers.renderSummary({
      findings: [],
      unanchored: [],
      posted: 0,
      healthy,
      reason: 'x',
      diffHash: HASH,
      promptHash: HASH,
    });
    assert.ok(
      body.includes(marker),
      `summary must carry ${marker} so find-comment updates in place (healthy=${healthy})`,
    );
  }
});

test('the dedup marker is exactly what commentBody emits', () => {
  // seenFingerprints must recognize our own output. If the emitter's marker and the
  // reader's regex drift, every finding reposts on every push.
  const f = { file: 'src/a.ts', line: 11, title: 'x', body: 'y' };
  const seen = helpers.seenFingerprints([{ body: helpers.commentBody(f) }]);
  assert.ok(
    seen.has(helpers.fingerprint(f)),
    'commentBody output must be parseable back',
  );
});

test('the summary accounts for findings skipped as already-posted', () => {
  const body = helpers.renderSummary({
    findings: [
      { file: 'a', line: 1, severity: 'major', title: 'new', body: 'b' },
      { file: 'b', line: 2, severity: 'major', title: 'old', body: 'b' },
    ],
    unanchored: [],
    skipped: [
      { file: 'b', line: 2, severity: 'major', title: 'old', body: 'b' },
    ],
    posted: 1,
    healthy: true,
    diffHash: HASH,
    promptHash: HASH,
  });
  assert.match(body, /1 unchanged from an earlier push/);
});

test('a count-omitted hunk header is treated as a single post-image line', () => {
  // `@@ -N +M @@` (no counts) is the common single-line-change shape. Getting the implied
  // count wrong silently misroutes every anchor after it.
  const diff = ['--- a/a.ts', '+++ b/a.ts', '@@ -5 +5 @@', '+only', ''].join(
    '\n',
  );
  const map = helpers.parseCommentableLines(diff);
  assert.deepEqual([...map.get('a.ts')], [5]);
});

test('findings containing a secret are identified so they can be refused', () => {
  const secret = 'sk-ant-notarealkey-000000000000000000';
  const clean = { file: 'a.ts', title: 'fine', body: 'no secrets here' };
  const leaky = {
    file: 'a.ts',
    title: 'env dump',
    body: `found ${secret} in the env`,
  };
  const found = helpers.findingsLeakingSecrets([clean, leaky], [secret]);
  assert.equal(found.length, 1);
  assert.equal(found[0].title, 'env dump');
});

test('short or empty secret values are ignored to avoid matching everything', () => {
  const findings = [{ file: 'a.ts', title: 'x', body: 'the value is 1' }];
  assert.deepEqual(
    helpers.findingsLeakingSecrets(findings, ['1', '', undefined]),
    [],
  );
});

test('the CLI pin stays in lockstep with deep-review.yml', () => {
  // Both workflows pin the same pre-regression CLI and both comments say to unpin
  // together, but nothing binds them -- a bump in one silently leaves the other on a
  // stale integrity hash. This is the binding.
  const read = name =>
    readFileSync(
      fileURLToPath(new URL(`../../../workflows/${name}`, import.meta.url)),
      'utf8',
    );
  const pin = text => ({
    version: /CLAUDE_CLI_VERSION:\s*(\S+)/.exec(text)?.[1],
    sha: /CLAUDE_CLI_SHA512:\s*(\S+)/.exec(text)?.[1],
  });
  const ours = pin(read('claude-code-review.yml'));
  const theirs = pin(read('deep-review.yml'));
  assert.ok(
    ours.version && ours.sha,
    'this workflow must declare a pinned CLI',
  );
  assert.equal(
    ours.version,
    theirs.version,
    'CLI version drifted from deep-review.yml',
  );
  assert.equal(
    ours.sha,
    theirs.sha,
    'CLI integrity hash drifted from deep-review.yml',
  );
});

test('a secret split across title and body is still caught', () => {
  // Joining fields with a separator and testing includes(fullSecret) misses this, yet the
  // two halves render adjacent in the published comment and are trivially reconstructed.
  const secret = 'ghp_averyrealisticlookingtokenvalue00';
  const half = secret.length >> 1;
  const split = {
    file: 'a.ts',
    title: `leaked ${secret.slice(0, half)}`,
    body: `${secret.slice(half)} was in the env`,
  };
  assert.equal(helpers.findingsLeakingSecrets([split], [secret]).length, 1);
});

test('the secret scan covers the title and file fields, not just the body', () => {
  const secret = 'sk-ant-anothernotrealkey-00000000000';
  for (const field of ['title', 'body', 'file']) {
    const f = { file: 'a.ts', title: 't', body: 'b', [field]: `x ${secret} y` };
    assert.equal(
      helpers.findingsLeakingSecrets([f], [secret]).length,
      1,
      `${field} must be scanned`,
    );
  }
});

test('a same-run duplicate is not reported as unchanged from an earlier push', () => {
  // `skipped` drives the "already inline above" wording, which is false for a duplicate
  // the reviewer emitted twice in this same run.
  const f = {
    file: 'src/a.ts',
    line: 11,
    severity: 'major',
    title: 'same',
    body: 'b',
  };
  const { inline, skipped, duplicates } = helpers.buildInlineComments({
    findings: [f, { ...f, line: 12 }],
    diffText: DIFF,
    existingComments: [],
  });
  assert.equal(inline.length, 1);
  assert.equal(skipped.length, 0, 'nothing was posted on an earlier push');
  assert.equal(duplicates.length, 1);
});

test('the reviewer schema and the renderer agree on the severity enum', () => {
  // The finding shape is declared in the workflow's --json-schema and independently
  // assumed here; renaming an enum value would pass every test while severityOf silently
  // degraded every finding to minor.
  const wf = readFileSync(WORKFLOW, 'utf8');
  const line = wf.split('\n').find(l => l.includes('--json-schema'));
  assert.ok(line, 'could not find --json-schema in the workflow');
  const schema = JSON.parse(
    line.slice(line.indexOf("'") + 1, line.lastIndexOf("'")),
  );
  const props = schema.properties.findings.items;
  assert.deepEqual(
    props.properties.severity.enum.slice().sort(),
    Object.keys(helpers.ICON).slice().sort(),
    'severity enum drifted from the icons the renderer knows',
  );
  for (const required of props.required) {
    assert.ok(
      ['file', 'title', 'body'].includes(required),
      `unexpected required field ${required}`,
    );
  }
});

test('the workflow contains no empty Actions expression', () => {
  // `${'$'}{{ }}` is parsed by Actions wherever it appears in a scalar -- including inside
  // what looks like a JS comment -- and an empty one fails the whole workflow to parse
  // with "An expression was expected". Nothing in the YAML linting or the test suite
  // catches it; only a real dispatch does. Caught exactly that way once.
  const wf = readFileSync(WORKFLOW, 'utf8');
  const empty = wf.split('\n').filter(l => /\$\{\{\s*\}\}/.test(l));
  assert.deepEqual(
    empty,
    [],
    'empty Actions expression would break workflow parsing',
  );
});

test('collapsed duplicates are excluded from the headline count', () => {
  // Found by this very workflow reviewing its own PR: splitting duplicates out of
  // `skipped` fixed the wording but left them in `findings.length`, so the total
  // advertised findings that appeared nowhere in the comment.
  const f = { file: 'a.ts', line: 1, severity: 'major', title: 'x', body: 'y' };
  const body = helpers.renderSummary({
    findings: [f, { ...f, line: 2 }],
    unanchored: [],
    skipped: [],
    duplicates: [{ ...f, line: 2 }],
    posted: 1,
    healthy: true,
    diffHash: HASH,
    promptHash: HASH,
  });
  assert.match(
    body,
    /\*\*1\*\* finding\(s\)/,
    'headline counts distinct findings',
  );
  assert.match(body, /1 duplicate\(s\) collapsed/);
});

test('severity tallies sum to the headline total when duplicates collapse', () => {
  // A per-severity count over every finding would not add up to the distinct total.
  const a = {
    file: 'a.ts',
    line: 1,
    severity: 'major',
    title: 'dup',
    body: 'y',
  };
  const b = {
    file: 'b.ts',
    line: 1,
    severity: 'minor',
    title: 'other',
    body: 'y',
  };
  const body = helpers.renderSummary({
    findings: [a, { ...a, line: 9 }, b],
    unanchored: [],
    skipped: [],
    duplicates: [{ ...a, line: 9 }],
    posted: 2,
    healthy: true,
    diffHash: HASH,
    promptHash: HASH,
  });
  const m =
    /\*\*(\d+)\*\* finding\(s\).*?(\d+) critical.*?(\d+) major.*?(\d+) minor/.exec(
      body,
    );
  assert.ok(m, 'headline not found');
  const [, total, crit, major, minor] = m.map(Number);
  assert.equal(total, 2, 'distinct findings');
  assert.equal(crit + major + minor, total, 'severities must sum to the total');
});
