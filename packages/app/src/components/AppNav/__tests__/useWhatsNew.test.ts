import { changelogUrl, formatCounts } from '@/components/AppNav/useWhatsNew';

describe('changelogUrl', () => {
  it('pins the link to the release tag, not main', () => {
    // Merging to main does not deploy, so main's changelog describes releases
    // this deployment may not be running.
    expect(changelogUrl('2.36.0')).toBe(
      'https://github.com/hyperdxio/hyperdx/blob/%40hyperdx%2Fapp%402.36.0/CHANGELOG.md',
    );
  });

  it('falls back to main when there is no release to key on', () => {
    expect(changelogUrl()).toBe(
      'https://github.com/hyperdxio/hyperdx/blob/main/CHANGELOG.md',
    );
  });
});

describe('formatCounts', () => {
  it('joins the counted sections into a sentence', () => {
    expect(
      formatCounts([
        { label: 'improvements', count: 5 },
        { label: 'bug fixes', count: 10 },
        { label: 'build / packaging', count: 1 },
      ]),
    ).toBe('5 improvements, 10 bug fixes and 1 build / packaging');
  });

  it('singularises the labels that need it at a count of one', () => {
    // The labels come from the release notes' own headings, which are plural.
    expect(formatCounts([{ label: 'improvements', count: 1 }])).toBe(
      '1 improvement',
    );
    expect(formatCounts([{ label: 'bug fixes', count: 1 }])).toBe('1 bug fix');
  });

  it('leaves a label that is not a plural alone', () => {
    expect(formatCounts([{ label: 'experimental', count: 1 }])).toBe(
      '1 experimental',
    );
  });

  it('is empty when a release counted nothing', () => {
    expect(formatCounts([])).toBe('');
  });
});
