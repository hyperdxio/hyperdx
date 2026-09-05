// changeset-hash.sh produces the hash that gates both the reuse decision and
// the publish job's staleness guard, so a path it silently drops is a
// correctness hole in both. Exercised against real git trees rather than mocked
// `ls-tree` output, since the parse is the part that goes wrong.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../changeset-hash.sh', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

/** A throwaway repo whose HEAD carries the given `.changeset` files. */
async function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'changeset-hash-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  await mkdir(join(dir, '.changeset'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, '.changeset', name), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'changesets');
  return dir;
}

function hash(dir) {
  return execFileSync('bash', [SCRIPT, 'HEAD'], {
    cwd: dir,
    encoding: 'utf-8',
  }).trim();
}

const CHANGESET = '---\n"@hyperdx/app": minor\n---\n\nA change.\n';

test('the hash covers names with spaces and non-ASCII characters', async () => {
  // `git ls-tree` splitting on whitespace would push these out of the path
  // field and drop them from the hash without failing.
  const base = await repoWith({ 'plain-name.md': CHANGESET });
  const withOdd = await repoWith({
    'plain-name.md': CHANGESET,
    'name with spaces.md': CHANGESET,
    'nöm-übér.md': CHANGESET,
  });

  assert.notEqual(hash(base), hash(withOdd));
});

test('the hash is stable across runs and independent of file order', async () => {
  const dir = await repoWith({
    'b.md': CHANGESET,
    'a.md': CHANGESET,
    'name with spaces.md': CHANGESET,
  });
  assert.equal(hash(dir), hash(dir));
  assert.match(hash(dir), /^[0-9a-f]{12}$/);
});

test('README.md is excluded but a changeset merely named after it is not', async () => {
  const bare = await repoWith({ 'a.md': CHANGESET });
  const withReadme = await repoWith({
    'a.md': CHANGESET,
    'README.md': '# Changesets\n',
  });
  const withReadmeishName = await repoWith({
    'a.md': CHANGESET,
    'fix-README-links.md': CHANGESET,
  });

  assert.equal(hash(bare), hash(withReadme));
  assert.notEqual(hash(bare), hash(withReadmeishName));
});

test('editing a changeset changes the hash', async () => {
  // Blob SHAs, not just the path set: an edited changeset must force
  // regeneration rather than reuse the previous section.
  const before = await repoWith({ 'a.md': CHANGESET });
  const after = await repoWith({ 'a.md': `${CHANGESET}More detail.\n` });

  assert.notEqual(hash(before), hash(after));
});

test('non-markdown files in .changeset do not affect the hash', async () => {
  const bare = await repoWith({ 'a.md': CHANGESET });
  const withConfig = await repoWith({
    'a.md': CHANGESET,
    'config.json': '{}\n',
  });

  assert.equal(hash(bare), hash(withConfig));
});
