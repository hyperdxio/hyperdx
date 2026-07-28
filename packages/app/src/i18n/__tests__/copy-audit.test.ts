import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const auditScript = path.join(appRoot, 'scripts/check-i18n.mjs');
const invalidFixture = 'scripts/__fixtures__/i18n-audit/invalid.tsx';

const runAudit = (...args: string[]) =>
  spawnSync(process.execPath, [auditScript, ...args], {
    cwd: appRoot,
    encoding: 'utf8',
  });

const parseQuoted = (value: string): string => String(JSON.parse(value));

const diagnosticTexts = (output: string): string[] =>
  [...output.matchAll(/: (".*")$/gm)].map(([, text]) => parseQuoted(text));

describe('i18n copy audit', () => {
  it('accepts the valid fixture', () => {
    const result = runAudit('--fixture', 'valid');

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('i18n audit passed (1 file(s) scanned)\n');
    expect(result.stderr).toBe('');
  });

  it('reports invalid fixture findings in deterministic order without interpolation identifiers', () => {
    const result = runAudit('--fixture', 'invalid');

    expect(result.status).toBe(1);
    expect(diagnosticTexts(result.stderr)).toEqual([
      'Saved successfully',
      'Added filter',
      'Edited filter',
      'Add filter',
      'Filter query',
      'Edit filter',
      'Welcome back',
      'Warning: Alerts require attention',
      'Hello',
      'Created',
      'Updated',
      'Add filter',
      'Wrapped filter',
      'Copied!',
      'Copy',
      'Add filter',
      'Edit filter',
      'Copy',
      'Close',
      'Search',
      'Add filter',
      'Edit filter',
      'Create filter',
      'Update filter',
    ]);
    expect(result.stderr).not.toContain('${name}');
    expect(result.stderr).not.toContain('actions.save');
  });

  it('formats and sorts diagnostics from fixture files independent of discovery order', () => {
    const result = runAudit('--fixture', 'deterministic-reverse');

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`i18n audit found 4 hardcoded string(s):
scripts/__fixtures__/i18n-audit/deterministic/a-second.tsx:3:5 JSX text: "Second text"
scripts/__fixtures__/i18n-audit/deterministic/a-second.tsx:4:18 title attribute: "Second title"
scripts/__fixtures__/i18n-audit/deterministic/z-first.tsx:3:18 title attribute: "First title"
scripts/__fixtures__/i18n-audit/deterministic/z-first.tsx:4:5 JSX text: "First text"
`);
  });

  it('detects a type assertion in a TypeScript fixture', () => {
    const result = runAudit('--fixture', 'invalid-ts');

    expect(result.status).toBe(1);
    expect(diagnosticTexts(result.stderr)).toEqual(['Type asserted filter']);
  });

  it.each([
    ['malformed JSON', '{', 'Unable to read'],
    [
      'duplicate entries',
      JSON.stringify([
        { file: invalidFixture, text: 'Copy', reason: 'test' },
        { file: invalidFixture, text: 'Copy', reason: 'test' },
      ]),
      'Duplicate allowlist entry',
    ],
    [
      'blank reasons',
      JSON.stringify([{ file: invalidFixture, text: 'Copy', reason: ' ' }]),
      'nonblank strings',
    ],
    [
      'stale entries',
      JSON.stringify([
        { file: invalidFixture, text: 'Unused', reason: 'test' },
      ]),
      'unused allowlist entry',
    ],
  ])('rejects %s allowlists', (_name, contents, expectedMessage) => {
    const temporaryDirectory = mkdtempSync(
      path.join(os.tmpdir(), 'i18n-audit-'),
    );
    const allowlistPath = path.join(temporaryDirectory, 'allowlist.json');

    try {
      writeFileSync(allowlistPath, contents);

      const result = runAudit(
        '--fixture',
        'valid',
        '--allowlist',
        allowlistPath,
      );

      expect(result.status).toBeGreaterThan(0);
      expect(result.stderr).toContain(expectedMessage);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
