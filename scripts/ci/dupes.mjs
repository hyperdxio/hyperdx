#!/usr/bin/env node
// Duplicate-code report. Advisory: always exits 0.
//
// jscpd's console reporter ignores --baseline-from-ref and prints every clone,
// so "what did this branch add" is only available as an `isNew` flag in the
// JSON report. This wraps the JSON run and renders the new clones.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGES = ['packages/app', 'packages/api', 'packages/common-utils'];
const CONFIG = join(ROOT, '.jscpd.json');

// Cap the number of duplicates listed in the PR comment
const MAX_LISTED_IN_COMMENT = 20;

const argv = process.argv.slice(2);
const all = argv.includes('--all');
const markdown = argv.includes('--markdown');
const baseIdx = argv.indexOf('--base');
const baseArg = argv[baseIdx + 1];
if (baseIdx !== -1 && (!baseArg || baseArg.startsWith('--'))) {
  console.error('--base requires a git ref, e.g. --base origin/main');
  process.exit(0);
}
const base = baseIdx === -1 ? 'origin/main' : baseArg;

// A malformed .jscpd.json makes jscpd log one line to stderr and carry on with
// its defaults, which scans markdown, tests and CHANGELOG.md. Fail loudly here
// instead of silently reporting noise.
try {
  JSON.parse(readFileSync(CONFIG, 'utf8'));
} catch (e) {
  console.error(`Cannot parse ${CONFIG}: ${e.message}`);
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), 'jscpd-'));
// process.exit skips finally blocks, so every exit path clears the temp dir
// through here instead.
const bail = message => {
  console.error(message);
  rmSync(out, { recursive: true, force: true });
  process.exit(0);
};

const args = [
  ...PACKAGES,
  '--absolute',
  '--no-tips',
  '--reporters',
  'json',
  '--output',
  out,
];
if (!all) args.push('--baseline-from-ref', base);

try {
  execFileSync(join(ROOT, 'node_modules', '.bin', 'jscpd'), args, {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
} catch (e) {
  bail(`jscpd failed to run: ${e.message}`);
}

const report = join(out, 'jscpd-report.json');
if (!existsSync(report)) bail('jscpd produced no report.');

const data = JSON.parse(readFileSync(report, 'utf8'));
rmSync(out, { recursive: true, force: true });
const total = data.statistics?.total ?? {};
const rel = p => (p.startsWith(`${ROOT}/`) ? p.slice(ROOT.length + 1) : p);
const at = f => `${rel(f.name)}:${f.start}-${f.end}`;
const duplicates = all
  ? (data.duplicates ?? [])
  : (data.duplicates ?? []).filter(c => c.isNew);
const plural = duplicates.length === 1 ? '' : 's';

if (markdown) {
  const lines = ['## Duplicate code analysis', ''];
  if (duplicates.length === 0) {
    lines.push('No new duplicate code introduced by this PR.');
  } else {
    lines.push(
      `**${duplicates.length} new clone${plural}** introduced by this PR.`,
      '',
    );
    for (const c of duplicates.slice(0, MAX_LISTED_IN_COMMENT)) {
      lines.push(
        `- \`${at(c.firstFile)}\` ↔ \`${at(c.secondFile)}\` — ${c.lines} lines`,
      );
    }
    if (duplicates.length > MAX_LISTED_IN_COMMENT) {
      lines.push(`- …and ${duplicates.length - MAX_LISTED_IN_COMMENT} more`);
    }
    lines.push(
      '',
      'If one of these duplicates a helper that already exists, import it instead',
      'of redefining it. If the duplication is deliberate, ignore this comment —',
      'the check is advisory and never fails the build.',
    );
  }
  lines.push(
    '',
    '---',
    `[jscpd](https://github.com/kucherenko/jscpd) compared this branch against \`${base}\``,
    'across app, api and common-utils. Only new clones are listed; the codebase',
    `currently holds ${total.clones ?? 0} in total (${(total.percentage ?? 0).toFixed(2)}%).`,
    'Run `yarn dupes` locally to reproduce, or `yarn dupes:all` for the full picture.',
  );
  console.log(lines.join('\n'));
  process.exit(0);
}

if (duplicates.length === 0) {
  console.log(
    all ? 'No duplicate code found.' : `No new duplicate code vs ${base}.`,
  );
} else {
  const scope = all ? 'in app, api and common-utils' : `vs ${base}`;
  console.log(`${duplicates.length} clone${plural} ${scope}:\n`);
  for (const c of duplicates) {
    console.log(`  ${at(c.firstFile)}`);
    console.log(`  ${at(c.secondFile)}  (${c.lines} lines)\n`);
  }
}
if (!all) {
  console.log(
    `Total duplication: ${total.clones ?? 0} clones (${(total.percentage ?? 0).toFixed(2)}%). ` +
      'Run `yarn dupes:all` to list them.',
  );
}
