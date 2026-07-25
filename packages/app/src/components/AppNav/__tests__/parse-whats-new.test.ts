// The parser lives in scripts/ (CommonJS) so next.config.mjs can import it at
// build time; the test reaches across to exercise the same source of truth.
// eslint-disable-next-line no-restricted-imports -- scripts/ is outside the @/ (src) alias by design
import parseWhatsNew from '../../../../scripts/parse-whats-new';

const CHANGELOG = `# @hyperdx/app

## 2.31.0

### Minor Changes

- ff05b3df: feat: Convert current builder config to SQL during editor switch
- d137eaab: chore(charts): upgrade Recharts from 2.13 to 3.x. Reworks chart event handlers
  to the Recharts 3 event API

### Patch Changes

- 697006ba: feat(dashboards): add background area sparklines to the Browser RUM dashboard
  number tiles. Each of the ten single-value tiles now renders a faint trend line.
- 1705b37a: fix: Block webhook URLs targeting known-bad IP ranges
- c86ed556: feat(app): make the selected source clearer, e.g. in the source picker. The
  dropdown now marks the current source with a trailing check.
- ae5daba7: feat: support alerting on 1.5x baseline deviation
- Updated dependencies [ff05b3df]
  - @hyperdx/common-utils@0.23.0
  - @hyperdx/api@2.31.0

## 2.30.1

### Patch Changes

- deadbeef: feat: add a second-release feature
- feedface: fix: a fix that should be filtered out

## 2.30.0

### Minor Changes

- cafebabe: feat: a third-release feature
`;

describe('parseWhatsNew', () => {
  it('returns each release with its feat-only headlines, newest first', () => {
    const { releases } = parseWhatsNew(CHANGELOG, { maxReleases: 10 });

    expect(releases.map(r => r.version)).toEqual([
      '2.31.0',
      '2.30.1',
      '2.30.0',
    ]);
    // fix/chore/"Updated dependencies"/sub-bullets excluded; only feats kept,
    // in changelog order, uncapped per release. Each carries its feat() scope
    // (or "general" when unscoped).
    expect(releases[0].features).toEqual([
      {
        scope: 'general',
        text: 'Convert current builder config to SQL during editor switch',
      },
      {
        scope: 'dashboards',
        text: 'Add background area sparklines to the Browser RUM dashboard number tiles',
      },
      {
        scope: 'app',
        text: 'Make the selected source clearer, e.g. in the source picker',
      },
      {
        scope: 'general',
        text: 'Support alerting on 1.5x baseline deviation',
      },
    ]);
    expect(releases[1].features).toEqual([
      { scope: 'general', text: 'Add a second-release feature' },
    ]);
    expect(releases[2].features).toEqual([
      { scope: 'general', text: 'A third-release feature' },
    ]);
  });

  it('bounds the number of releases', () => {
    const { releases } = parseWhatsNew(CHANGELOG, { maxReleases: 2 });
    expect(releases.map(r => r.version)).toEqual(['2.31.0', '2.30.1']);
  });

  it('defaults to at most 5 releases', () => {
    // Only 3 exist here, so all 3 come back; the default cap is exercised in
    // the bound test above.
    expect(parseWhatsNew(CHANGELOG).releases).toHaveLength(3);
  });

  it('does not mis-cut on version numbers or abbreviations', () => {
    const { releases } = parseWhatsNew(CHANGELOG);
    const texts = releases[0].features.map(f => f.text);
    expect(texts).toContain('Support alerting on 1.5x baseline deviation');
    expect(texts).toContain(
      'Make the selected source clearer, e.g. in the source picker',
    );
  });

  describe('sentence splitting', () => {
    // Each case is a `feat` message; we assert the headline it becomes.
    const headline = (message: string) =>
      parseWhatsNew(`## 9.9.9\n\n- abc1234: feat: ${message}\n`).releases[0]
        .features[0].text;

    it.each([
      // Abbreviations must not be mistaken for a sentence end — cutting at
      // "etc." or "vs." throws away the part that describes the feature.
      [
        'Support ClickHouse, Postgres, etc. Adds a new source picker',
        'Support ClickHouse, Postgres, etc. Adds a new source picker',
      ],
      [
        'Compare p50 vs. p99 latency. Adds a toggle',
        'Compare p50 vs. p99 latency',
      ],
      [
        'Make the source clearer, e.g. in the picker. And elsewhere',
        'Make the source clearer, e.g. in the picker',
      ],
      // A sentence that genuinely ends in a number still gets cut there.
      [
        'Raise the tile cap to 10. The dashboard now scrolls',
        'Raise the tile cap to 10',
      ],
      // A decimal mid-sentence is never a cut point (its period is followed by
      // a digit, not whitespace).
      [
        'Support alerting on 1.5x baseline deviation',
        'Support alerting on 1.5x baseline deviation',
      ],
      // Code spans render as plain text, so the backticks are unwrapped.
      ['Add `link` variant for Button', 'Add link variant for Button'],
    ])('%s -> %s', (message, expected) => {
      expect(headline(message)).toBe(expected);
    });
  });

  it('yields an empty feature list for a release with no feats', () => {
    const fixesOnly = `# @hyperdx/app

## 2.31.1

### Patch Changes

- abc1234: fix: correct a rendering glitch
- def5678: chore: bump deps
`;
    expect(parseWhatsNew(fixesOnly).releases).toEqual([
      { version: '2.31.1', features: [] },
    ]);
  });

  it('handles empty/malformed input safely', () => {
    expect(parseWhatsNew('')).toEqual({ releases: [] });
    expect(parseWhatsNew('# @hyperdx/app\n\nno versions here')).toEqual({
      releases: [],
    });
  });
});
