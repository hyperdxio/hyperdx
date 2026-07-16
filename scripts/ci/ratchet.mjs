#!/usr/bin/env node
/**
 * Ratchet: counts of tracked escape hatches may only go down.
 * Above baseline -> fail (you added one; remove it).
 * Below baseline -> warn only (run `yarn ratchet:update` to lock the
 *   improvement in). Non-fatal so an improvement can never turn `main` red —
 *   e.g. when two count-lowering PRs merge close together and `main`'s
 *   committed baseline briefly sits above the real count.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const BASELINE = path.join(ROOT, 'scripts/ci/ratchet-baseline.json');
const PACKAGES = ['app', 'api', 'common-utils', 'cli', 'hdx-eval'];
const PATTERNS = {
  'as-any': 'as any',
  'ts-ignore': '@ts-ignore',
  'eslint-disable': 'eslint-disable',
};

function count(pattern, dir) {
  // A renamed/removed package (or a new PACKAGES entry added before its source
  // exists) would make grep exit 2, not 1; treat a missing dir as zero rather
  // than crashing the whole ratchet with an opaque stack trace.
  if (!existsSync(dir)) return 0;
  try {
    const out = execFileSync(
      'grep',
      ['-rEo', pattern, dir, '--include=*.ts', '--include=*.tsx'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return out.split('\n').filter(Boolean).length;
  } catch (err) {
    if (err.status === 1) return 0; // grep exit 1 = no matches
    throw err;
  }
}

const current = {};
for (const pkg of PACKAGES) {
  const dir = path.join(ROOT, 'packages', pkg, 'src');
  current[pkg] = Object.fromEntries(
    Object.entries(PATTERNS).map(([name, re]) => [name, count(re, dir)]),
  );
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`ratchet baseline written to ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
let failed = false;
for (const pkg of PACKAGES) {
  for (const name of Object.keys(PATTERNS)) {
    const now = current[pkg][name];
    const max = baseline[pkg]?.[name] ?? 0;
    if (now > max) {
      failed = true;
      console.error(
        `x ${pkg}/${name}: ${now} > baseline ${max} — remove the new occurrence(s)`,
      );
    } else if (now < max) {
      // Non-fatal: an improvement must never fail CI (it would red `main` and
      // every open PR until someone re-baselines). Just nudge to lock it in.
      console.warn(
        `! ${pkg}/${name}: ${now} < baseline ${max} — run \`yarn ratchet:update\` to lock the improvement in`,
      );
    }
  }
}
if (failed) process.exit(1);
console.log('ratchet ok: all escape-hatch counts at baseline');
