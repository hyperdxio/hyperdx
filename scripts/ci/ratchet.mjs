#!/usr/bin/env node
/**
 * Ratchet: counts of tracked escape hatches may only go down.
 * Above baseline -> fail (you added one; remove it).
 * Below baseline -> warn only (run `yarn ratchet:update` to lock the
 *   improvement in). Non-fatal so an improvement can never turn `main` red —
 *   e.g. when two count-lowering PRs merge close together and `main`'s
 *   committed baseline briefly sits above the real count.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PATTERNS = {
  // Word-anchored: a bare `as any` substring also matches prose like
  // "...has any dashboards", inflating the baseline with phantom counts.
  'as-any': /\bas any\b/g,
  'ts-ignore': /@ts-ignore/g,
  'eslint-disable': /eslint-disable/g,
};

// Generated, vendored or build output — not ours to ratchet.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nx',
  '.turbo',
]);
const EXTS = new Set(['.ts', '.tsx']);

/**
 * Workspace package directories, keyed by directory name. Derived from the
 * root `workspaces` globs rather than hardcoded, so a newly added package is
 * gated from day one instead of being silently ungated.
 */
export function discoverPackages(root) {
  const { workspaces } = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  const globs = Array.isArray(workspaces)
    ? workspaces
    : (workspaces?.packages ?? []);
  const found = new Map();
  for (const glob of globs) {
    // ponytail: only the `dir/*` and literal-path forms this repo uses; reach
    // for a glob library if the workspaces field ever gets fancier.
    let candidates;
    if (glob.endsWith('/*')) {
      const parent = glob.slice(0, -2);
      const parentDir = path.join(root, parent);
      candidates = existsSync(parentDir)
        ? readdirSync(parentDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(parent, entry.name))
        : [];
    } else {
      candidates = [glob];
    }
    for (const rel of candidates) {
      if (existsSync(path.join(root, rel, 'package.json'))) {
        found.set(path.basename(rel), path.join(root, rel));
      }
    }
  }
  return found;
}

function countDir(dir) {
  const counts = Object.fromEntries(Object.keys(PATTERNS).map(n => [n, 0]));
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const sub = countDir(full);
      for (const name of Object.keys(counts)) counts[name] += sub[name];
    } else if (entry.isFile() && EXTS.has(path.extname(entry.name))) {
      const src = readFileSync(full, 'utf8');
      for (const [name, re] of Object.entries(PATTERNS)) {
        counts[name] += src.match(re)?.length ?? 0;
      }
    }
  }
  return counts;
}

/** Escape-hatch counts for every workspace package, keyed by package dir name. */
export function collectCounts(root) {
  const current = {};
  for (const [name, dir] of [...discoverPackages(root)].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    current[name] = countDir(dir);
  }
  return current;
}

/** @returns {{failed: boolean, improved: boolean, messages: string[]}} */
export function compare(current, baseline) {
  const messages = [];
  let failed = false;
  let improved = false;

  // A baselined package that no longer resolves means enforcement just
  // silently dropped for it (renamed dir, moved package, deleted workspace).
  // Zero counts would sail through the non-fatal below-baseline branch, so
  // this has to be its own hard error.
  for (const pkg of Object.keys(baseline)) {
    if (!(pkg in current)) {
      failed = true;
      messages.push(
        `x ${pkg}: in the baseline but not a workspace package any more — drop it from the baseline if that's intended`,
      );
    }
  }

  for (const pkg of Object.keys(current)) {
    for (const name of Object.keys(PATTERNS)) {
      const now = current[pkg][name];
      const max = baseline[pkg]?.[name] ?? 0;
      if (now > max) {
        failed = true;
        messages.push(
          `x ${pkg}/${name}: ${now} > baseline ${max} — remove the new occurrence(s)`,
        );
      } else if (now < max) {
        // Non-fatal: an improvement must never fail CI (it would red `main`
        // and every open PR until someone re-baselines). Just nudge.
        improved = true;
        messages.push(
          `! ${pkg}/${name}: ${now} < baseline ${max} — run \`yarn ratchet:update\` to lock the improvement in`,
        );
      }
    }
  }
  return { failed, improved, messages };
}

function main() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const baselinePath = path.join(root, 'scripts/ci/ratchet-baseline.json');
  const current = collectCounts(root);

  if (process.argv.includes('--update')) {
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
    console.log(
      `ratchet baseline written to ${path.relative(root, baselinePath)}`,
    );
    return 0;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const { failed, improved, messages } = compare(current, baseline);
  for (const message of messages) {
    (message.startsWith('x ') ? console.error : console.warn)(message);
  }
  if (failed) return 1;
  console.log(
    improved
      ? 'ratchet ok: some counts are below baseline (see above)'
      : 'ratchet ok: all escape-hatch counts at baseline',
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
