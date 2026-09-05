#!/usr/bin/env node
/**
 * Ratchet: counts of tracked escape hatches may only go down.
 * Above baseline -> fail (you added one; remove it).
 * Below baseline -> warn only (run `yarn ratchet:update` to lock the
 *   improvement in). Non-fatal so an improvement can never turn `main` red —
 *   e.g. when two count-lowering PRs merge close together and `main`'s
 *   committed baseline briefly sits above the real count.
 * Advisory patterns (see ADVISORY) are counted and reported but never fail.
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
  // Duplication licensed by comment. `@source` marks code copied from another
  // package (mostly packages/cli/src/shared today, plus a handful under
  // src/components, src/utils and src/api).
  '@source': /@source packages\//g,
};

/**
 * Counted and reported, never fatal.
 *
 * `@source` is a doc comment, not an escape hatch. Deleting an `as any` or an
 * `eslint-disable` forces the underlying problem to surface; deleting an
 * `@source` line removes the record of a copy, not the copy. Gating on it would
 * only teach people to stop annotating their ports — the one behaviour that
 * makes the duplication findable. So the number is tracked and surfaced, and
 * lowering it means moving the code into `common-utils`.
 */
export const ADVISORY = new Set(['@source']);

// Generated, vendored or build output — not ours to ratchet.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.nx',
  '.turbo',
  // .next* is skipped by prefix below
]);
const EXTS = new Set(['.ts', '.tsx']);

/**
 * `.next` by prefix, not exact name: `NEXT_DIST_DIR` moves the build output
 * (E2E runs use `.next-e2e`).
 */
function isSkippedDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.next');
}

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
      if (isSkippedDir(entry.name)) continue;
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
      if (now > max && ADVISORY.has(name)) {
        messages.push(
          `! ${pkg}/${name}: ${now} > baseline ${max} — advisory; move the copy into common-utils if you can, then run \`yarn ratchet:update\``,
        );
      } else if (now > max) {
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
  const { failed, messages } = compare(current, baseline);
  for (const message of messages) {
    (message.startsWith('x ') ? console.error : console.warn)(message);
  }
  if (failed) return 1;
  console.log(
    messages.length
      ? 'ratchet ok: nothing above a gated baseline (see notes above)'
      : 'ratchet ok: all escape-hatch counts at baseline',
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
