import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectCounts, compare, discoverPackages } from '../ratchet.mjs';

/** Builds a throwaway workspace: { pkgName: { 'src/a.ts': 'source' } }. */
function fixture(packages, workspaces = ['packages/*']) {
  const root = mkdtempSync(path.join(tmpdir(), 'ratchet-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'root', private: true, workspaces }),
  );
  for (const [pkg, files] of Object.entries(packages)) {
    const dir = path.join(root, 'packages', pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg }));
    for (const [rel, source] of Object.entries(files)) {
      const file = path.join(dir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
  }
  test.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('counts escape hatches across a package, not just src/', () => {
  const root = fixture({
    app: {
      'src/a.ts': 'const x = y as any;\n// @ts-ignore\n',
      'scripts/gen.ts': '// eslint-disable-next-line no-console\n',
    },
  });
  assert.deepEqual(collectCounts(root), {
    app: { 'as-any': 1, 'ts-ignore': 1, 'eslint-disable': 1 },
  });
});

test('`as any` is word-anchored, so prose does not inflate the count', () => {
  const root = fixture({
    app: {
      'src/a.ts': [
        '// true if the user has any dashboards',
        'const klass = node as anything;',
        'const real = node as any;',
      ].join('\n'),
    },
  });
  assert.equal(collectCounts(root).app['as-any'], 1);
});

test('skips node_modules and build output', () => {
  const root = fixture({
    app: {
      'src/a.ts': 'const x = y as any;',
      'node_modules/dep/index.ts': 'const a = b as any;',
      'dist/bundle.ts': 'const a = b as any;',
      // `NEXT_DIST_DIR` renames this, so it is matched by prefix.
      '.next/dev/types/validator.ts': 'const a = b as any;',
      '.next-e2e/dev/types/validator.ts': 'const a = b as any;',
    },
  });
  assert.equal(collectCounts(root).app['as-any'], 1);
});

test('discovers new workspace packages automatically', () => {
  const root = fixture({
    app: { 'src/a.ts': '' },
    'brand-new': { 'src/a.ts': 'const x = y as any;' },
  });
  assert.deepEqual([...discoverPackages(root).keys()].sort(), [
    'app',
    'brand-new',
  ]);
  // Not in the baseline yet, so its implicit ceiling is zero.
  assert.equal(compare(collectCounts(root), { app: {} }).failed, true);
});

test('above baseline fails', () => {
  const { failed, messages } = compare(
    { app: { 'as-any': 3, 'ts-ignore': 0, 'eslint-disable': 0 } },
    { app: { 'as-any': 2, 'ts-ignore': 0, 'eslint-disable': 0 } },
  );
  assert.equal(failed, true);
  assert.match(messages.join('\n'), /app\/as-any: 3 > baseline 2/);
});

test('at baseline passes quietly', () => {
  const counts = { app: { 'as-any': 2, 'ts-ignore': 0, 'eslint-disable': 0 } };
  assert.deepEqual(compare(counts, counts), {
    failed: false,
    improved: false,
    messages: [],
  });
});

test('below baseline warns but does not fail', () => {
  const { failed, improved, messages } = compare(
    { app: { 'as-any': 1, 'ts-ignore': 0, 'eslint-disable': 0 } },
    { app: { 'as-any': 2, 'ts-ignore': 0, 'eslint-disable': 0 } },
  );
  assert.equal(failed, false);
  assert.equal(improved, true);
  assert.match(messages.join('\n'), /app\/as-any: 1 < baseline 2/);
});

test('a baselined package that vanished is a hard error, not a free pass', () => {
  const { failed, messages } = compare(
    {},
    { app: { 'as-any': 212, 'ts-ignore': 11, 'eslint-disable': 133 } },
  );
  assert.equal(failed, true);
  assert.match(messages.join('\n'), /not a workspace package any more/);
});

test('the committed baseline is not already breached by the real repo', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const baseline = JSON.parse(
    readFileSync(path.join(repoRoot, 'scripts/ci/ratchet-baseline.json'), 'utf8'),
  );
  // Only asserts not-above-baseline: below-baseline is a deliberate warn.
  assert.equal(compare(collectCounts(repoRoot), baseline).failed, false);
});
