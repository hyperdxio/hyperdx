import { readFileSync } from 'fs';
import { join } from 'path';

import {
  changelogUrl,
  formatCounts,
  whatsNewSchema,
} from '@/components/AppNav/useWhatsNew';

// eslint-disable-next-line no-restricted-imports -- scripts/ is outside the @/ (src) alias by design
import parseWhatsNew from '../../../../scripts/parse-whats-new';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');

describe('whats-new.json contract', () => {
  it('accepts what the build-time parser emits for the real changelog', () => {
    // next.config.mjs writes this payload at build time and the drawer validates
    // it at runtime. Nothing else pins the two together, and a mismatch shows
    // every user "Unable to load recent releases".
    const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8');
    const payload = parseWhatsNew(changelog, { maxReleases: 5 });

    expect(() => whatsNewSchema.parse(payload)).not.toThrow();
    expect(whatsNewSchema.parse(payload).releases.length).toBeGreaterThan(0);
  });
});

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
