// review-comments.cjs decides where every review finding lands: inline on a diff line, or
// in the summary. Both failure directions are silent -- a bad line map drops findings into
// the summary that should have been inline, and a bad fingerprint reposts the same comment
// on every push. Neither shows up as a workflow failure, so they are pinned here.
//
// Run by claude-code-review.yml before the (expensive) review step.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const helpers = require('../review-comments.cjs');

/** Two files, three hunks, including a pure deletion and an added file. */
const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,5 @@ export function a() {
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
  assert.equal(inline[0].path, 'src/a.ts');
  assert.equal(inline[0].line, 11);
  assert.equal(inline[0].side, 'RIGHT');

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
  const previous = {
    body: `whatever\n\n<!-- hdxr:${helpers.fingerprint(finding)} -->`,
  };

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

// The gate in claude-code-review.yml parses this marker to decide whether to re-review.
// Keep in lockstep with MARKER_RE there.
const GATE_RE =
  /claude-review-state:\s*diff=([0-9a-f]{64});\s*prompt=([0-9a-f]{64})\s*-->/;
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
  const m = GATE_RE.exec(body);
  assert.ok(m, 'gate must be able to read the state it wrote');
  assert.equal(m[1], HASH);
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
  assert.equal(GATE_RE.exec(body), null);
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
  assert.ok(GATE_RE.exec(body), 'a clean review is still a completed review');
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
  assert.match(inline[0].body, /\*\*minor\*\*/);
});
