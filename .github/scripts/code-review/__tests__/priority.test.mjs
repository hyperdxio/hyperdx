import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const helpers = require('../review-comments.cjs');

// What effectivePriority shows and folds. The order of its four steps is the thing most
// likely to be "tidied" into something that silently stops folding, so it is pinned here.

const graded = (over = {}) => ({
  file: 'src/a.ts',
  line: 11,
  title: 't',
  body: 'b',
  severity: 'major',
  priority: 'P2',
  hasFailureMode: true,
  reachableToday: false,
  ...over,
});

test('an ungraded finding is never folded', () => {
  // The grading pass can fail on its own. When it does, the review must post as it did
  // before the pass existed, ranked by the reviewer's own severity.
  const ungraded = sev => helpers.effectivePriority({ file: 'a', title: 't', body: 'b', severity: sev });
  assert.equal(ungraded('critical'), 'P0');
  assert.equal(ungraded('major'), 'P1');
  assert.equal(ungraded('minor'), 'P2');
  assert.equal(
    helpers.effectivePriority({ file: 'a', title: 't', body: 'b', severity: 'minor', priority: 'P9' }),
    'P2',
    'an unknown priority is treated as ungraded, not guessed at',
  );
});

test('a P2 the reviewer called minor is folded; one it called major is not', () => {
  assert.equal(helpers.effectivePriority(graded({ severity: 'minor' })), 'P3');
  assert.equal(helpers.effectivePriority(graded({ severity: 'major' })), 'P2');
  assert.equal(helpers.effectivePriority(graded({ severity: 'critical', priority: 'P1' })), 'P1');
});

test('neither grader alone can fold a finding', () => {
  // The grader alone: a P3 on something the reviewer called major/critical stays visible,
  // whatever hasFailureMode says. One model call must not hide a critical.
  for (const severity of ['major', 'critical']) {
    for (const hasFailureMode of [true, false]) {
      assert.equal(helpers.effectivePriority(graded({ priority: 'P3', severity, hasFailureMode })), 'P2');
    }
  }
  // The reviewer alone: a minor it graded P1 is posted as P1.
  assert.equal(helpers.effectivePriority(graded({ priority: 'P1', severity: 'minor' })), 'P1');
  // Both low: folded, and hasFailureMode does not rescue it.
  for (const hasFailureMode of [true, false]) {
    assert.equal(helpers.effectivePriority(graded({ priority: 'P3', severity: 'minor', hasFailureMode })), 'P3');
  }
});

test('security wording matches its word forms, not just the bare stem', () => {
  // The floor once ended in \b, so these never matched and could be folded.
  for (const title of [
    'Unsafe deserialization of the request body',
    'Input is never sanitized before use',
    'Secrets are logged on startup',
    'Passwords are compared in non-constant time',
    'API keys are echoed into the error message',
    'Credentials leak into the query string',
  ]) {
    assert.ok(helpers.isSecurityShaped({ title, body: '' }), title);
    assert.equal(helpers.effectivePriority(graded({ priority: 'P2', severity: 'minor', title })), 'P2', title);
  }
});

test('reachable-today and security-shaped findings are never folded, whatever came before', () => {
  assert.equal(
    helpers.effectivePriority(graded({ severity: 'minor', reachableToday: true })),
    'P2',
    'the floor is the last word: it overrides the minor-P2 policy',
  );
  assert.equal(
    helpers.effectivePriority(graded({ priority: 'P3', severity: 'minor', hasFailureMode: false, reachableToday: true })),
    'P2',
  );
  assert.equal(
    helpers.effectivePriority(
      graded({ priority: 'P3', severity: 'minor', hasFailureMode: false, title: 'Unescaped table name spliced into the query' }),
    ),
    'P2',
    'a grader once filed an unescaped SQL splice as a nit',
  );
});

test('applyGrades merges by index and ignores grades it cannot trust', () => {
  const findings = [graded({ priority: undefined }), graded({ priority: undefined, title: 'u' })];
  const out = helpers.applyGrades(findings, [
    { index: 0, priority: 'P3', hasFailureMode: false, reachableToday: true },
    { index: 1, priority: 'P7' }, // unknown priority: left ungraded
    { index: 5, priority: 'P0' }, // no such finding: ignored
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].priority, 'P3');
  assert.equal(out[0].reachableToday, true);
  assert.equal(out[1].priority, undefined);
  assert.deepEqual(helpers.applyGrades(findings, null), findings, 'no grades: unchanged');
});

test('regradeInput numbers every finding so grades map back by index', () => {
  const text = helpers.regradeInput([graded({ title: 'first' }), graded({ title: 'second' })]);
  assert.match(text, /FINDINGS TO GRADE \(2\)/);
  assert.match(text, /- index: 0\n {2}file: src\/a\.ts\n {2}issue: first/);
  assert.match(text, /- index: 1\n {2}file: src\/a\.ts\n {2}issue: second/);
});
