// The validator is the only thing standing between a malformed VOUCHED.td and
// an auto-merge, so the cases that matter are the ones that look fine to a
// skim: a handle that parses but is not lower-case, a duplicate hidden by a
// free-text reason, an entry that slipped out of sort order.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { diffLists, parseList } from '../vouch-list-validate.mjs';

const LIST = fileURLToPath(new URL('../../VOUCHED.td', import.meta.url));

test('the checked-in list is valid', () => {
  const { entries, errors } = parseList(readFileSync(LIST, 'utf-8'));
  assert.deepEqual(errors, []);
  assert.ok(entries.length > 0);
});

test('accepts the documented entry forms', () => {
  const { entries, errors } = parseList(
    [
      '# comment',
      '',
      'alice',
      'bob wants to fix the timezone bug',
      '-carol spam',
      'github:dave',
    ].join('\n'),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    entries.map(e => [e.handle, e.denounced]),
    [
      ['alice', false],
      ['bob', false],
      ['carol', true],
      ['dave', false],
    ],
  );
});

test('rejects mixed case, bad handles, duplicates and bad order', () => {
  const errors = text => parseList(text).errors;
  assert.match(errors('Alice').join(), /not a lower-case GitHub handle/);
  assert.match(errors('@alice').join(), /not a lower-case GitHub handle/);
  assert.match(
    errors('-alice').concat(errors('alice\n-alice')).join(),
    /already listed/,
  );
  assert.match(errors('bob\nalice').join(), /out of order/);
  assert.match(errors('  alice').join(), /leading whitespace/);
});

test('diff reports adds, removes and vouch-to-denounce flips', () => {
  const base = 'alice\nbob\ncarol\n';
  assert.deepEqual(diffLists(base, 'alice\nbob\ncarol\ndave\n').added, [
    'dave',
  ]);
  assert.deepEqual(diffLists(base, 'alice\ncarol\n').removed, ['bob']);
  assert.deepEqual(diffLists(base, 'alice\n-bob spam\ncarol\n').changed, [
    'bob',
  ]);
});

test('a broken base does not fail the PR, a broken head does', () => {
  assert.deepEqual(diffLists('Alice\n', 'alice\nbob\n').errors, []);
  assert.match(diffLists('alice\n', 'alice\nBob\n').errors.join(), /Bob/);
});
