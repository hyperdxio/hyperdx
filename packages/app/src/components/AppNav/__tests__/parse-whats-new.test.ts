// The parser lives in scripts/ (CommonJS) so next.config.mjs can import it at
// build time; the test reaches across to exercise the same source of truth.
// eslint-disable-next-line no-restricted-imports -- scripts/ is outside the @/ (src) alias by design
import parseWhatsNew from '../../../../scripts/parse-whats-new';

// Mirrors the shape .github/scripts/release-notes.mjs writes into the root
// CHANGELOG.md during a release, including the soft-wrapped bold lead-ins and
// the appended package list.
const CHANGELOG = `# HyperDX Changelog

Release-level highlights across all packages. Maintainer preamble that must
never reach users.

## v2.36.0 — 2026-08-21

<!-- hyperdx-release-notes version=2.36.0 inputs=abc123 -->

**Formulas land on every chart**

Formulas are the headline of this release. Read [the docs](https://docs.hyperdx.io/formulas).

### 💥 Breaking Changes

- **The API's log level now defaults to \`info\`, and query SQL is no longer
  dumped to the console**: set \`HYPERDX_LOG_LEVEL=debug\` if you relied on it
  (#2679).

### ✨ New Features

- **Formulas on metric, log and trace charts**: time series, table and number
  charts gain an "Add Formula" row (#2909, #2908).
- **\`clickstack_emerging_signals\` MCP tool**: surfaces newly-appearing errors
  (#2810).
- A bullet written without a bold lead-in. It still names the change.

### 🔧 Improvements

- **Faster metadata queries**: cached (#2801).
- **Tidier trace layout**: wraps (#2802).

### 🐛 Bug Fixes

- **Fix a chart crash**: guard (#2803).

### 📦 Package changelogs

- @hyperdx/app@2.36.0

## v2.35.0 — 2026-08-14

<!-- hyperdx-release-notes version=2.35.0 inputs=def456 -->

### ✨ New Features

- **Alert evaluation history over the API**: read past evaluations (#2700).

## v2.34.1 — 2026-08-10

### 🐛 Bug Fixes

- **Fix a replay stall**: order events (#2701).
`;

describe('parseWhatsNew', () => {
  it('reads the version, date and GitHub anchor from each release heading', () => {
    const { releases } = parseWhatsNew(CHANGELOG);

    expect(releases.map(r => r.version)).toEqual([
      '2.36.0',
      '2.35.0',
      '2.34.1',
    ]);
    expect(releases[0].date).toBe('2026-08-21');
    // GitHub drops punctuation and turns each space into a hyphen, so the em
    // dash leaves a double hyphen behind.
    expect(releases[0].anchor).toBe('v2360--2026-08-21');
  });

  it('reads the headline and summary the release notes open with', () => {
    const { releases } = parseWhatsNew(CHANGELOG);

    expect(releases[0].title).toBe('Formulas land on every chart');
    // Only the first sentence: a whole paragraph in the release card reads as
    // body text rather than a headline. The markdown is kept — the drawer
    // renders it, with images dropped and link hosts allowlisted.
    expect(releases[0].summary).toBe(
      'Formulas are the headline of this release.',
    );
  });

  it('never reads the release-notes marker as the summary', () => {
    const { releases } = parseWhatsNew(CHANGELOG);

    expect(releases[0].summary).not.toContain('hyperdx-release-notes');
  });

  it('still shows a summary when the notes carry no headline', () => {
    // Releases written before the notes carried a headline, and any a maintainer
    // strips, must still show their opening sentence.
    const { releases } = parseWhatsNew(`## v1.0.0 — 2026-01-01

Just a summary, no headline.

### ✨ New Features

- **A thing**: yes (#1).
`);

    expect(releases[0].title).toBeUndefined();
    expect(releases[0].summary).toBe('Just a summary, no headline.');
  });

  it('splits a promoted headline at the claim, keeping the detail below it', () => {
    // The notes open "the claim: the detail". The whole sentence is far too long
    // to read as a headline, and dropping the detail leaves a card that says
    // almost nothing.
    const { releases } = parseWhatsNew(`## v1.0.0 — 2026-01-01

Formulas are the headline of this release: any metric, log or trace chart can
now carry a derived series written as letter-ref arithmetic.

### ✨ New Features

- **A thing**: yes (#1).
`);

    expect(releases[0].title).toBe('Formulas are the headline of this release');
    expect(releases[0].summary).toBe(
      'Any metric, log or trace chart can now carry a derived series written as letter-ref arithmetic.',
    );
  });

  it('keeps a colon-less opening sentence whole as the summary', () => {
    const { releases } = parseWhatsNew(`## v1.0.0 — 2026-01-01

Dashboards got faster this release. And some other sentence.

### ✨ New Features

- **A thing**: yes (#1).
`);

    expect(releases[0].title).toBeUndefined();
    expect(releases[0].summary).toBe('Dashboards got faster this release.');
  });

  it('takes the bolded lead-in of breaking changes and new features', () => {
    const { releases } = parseWhatsNew(CHANGELOG);

    expect(releases[0].highlights).toEqual([
      {
        kind: 'breaking',
        text: "The API's log level now defaults to info, and query SQL is no longer dumped to the console",
      },
      { kind: 'feature', text: 'Formulas on metric, log and trace charts' },
      { kind: 'feature', text: 'clickstack_emerging_signals MCP tool' },
      {
        kind: 'feature',
        text: 'A bullet written without a bold lead-in',
      },
    ]);
  });

  it('keeps the case of a headline that opens with a code identifier', () => {
    const { releases } = parseWhatsNew(CHANGELOG);

    // Capitalising would rename it to something that does not exist.
    expect(releases[0].highlights[2].text).toBe(
      'clickstack_emerging_signals MCP tool',
    );
  });

  it('counts every other section instead of listing it', () => {
    const { releases } = parseWhatsNew(CHANGELOG);

    expect(releases[0].counts).toEqual([
      { label: 'improvements', count: 2 },
      { label: 'bug fixes', count: 1 },
    ]);
  });

  it('leaves the appended package list out of the counts', () => {
    const { releases } = parseWhatsNew(CHANGELOG);

    expect(releases[0].counts.map(c => c.label)).not.toContain(
      'package changelogs',
    );
  });

  it('never reads the file title or maintainer preamble as a release', () => {
    const { releases } = parseWhatsNew(CHANGELOG);

    expect(releases.map(r => r.version)).not.toContain('HyperDX Changelog');
    const text = JSON.stringify(releases);
    expect(text).not.toContain('Maintainer preamble');
  });

  it('emits a fix-only release with no highlights rather than skipping it', () => {
    const { releases } = parseWhatsNew(CHANGELOG);
    const patch = releases[2];

    // The Help-menu peek skips past these itself; dropping them here would make
    // the drawer claim the release never happened.
    expect(patch.version).toBe('2.34.1');
    expect(patch.highlights).toEqual([]);
    expect(patch.counts).toEqual([{ label: 'bug fixes', count: 1 }]);
  });

  it('bounds the release count', () => {
    expect(parseWhatsNew(CHANGELOG, { maxReleases: 2 }).releases).toHaveLength(
      2,
    );
  });

  it('returns no releases for a changelog that has none yet', () => {
    expect(
      parseWhatsNew('# HyperDX Changelog\n\nNothing released yet.\n').releases,
    ).toEqual([]);
  });

  it('tolerates empty and missing input', () => {
    expect(parseWhatsNew('').releases).toEqual([]);
    expect(parseWhatsNew().releases).toEqual([]);
  });

  it('drops a trailing period from a lead-in-less bullet but not mid-sentence ones', () => {
    const { releases } = parseWhatsNew(`## v1.0.0

### ✨ New Features

- Supports Postgres, etc. and a picker on top.
`);

    // "etc." must not be read as the end of the sentence.
    expect(releases[0].highlights[0].text).toBe(
      'Supports Postgres, etc. and a picker on top',
    );
  });
});
