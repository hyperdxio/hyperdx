import {
  allowChangelogUrl,
  toChangelogBody,
} from '@/components/AppNav/ChangelogModal';

// Mirrors the shape .github/scripts/release-notes.mjs writes into the root
// CHANGELOG.md during a release.
const ROOT_CHANGELOG = `# HyperDX Changelog

Release-level highlights across all HyperDX packages. Each entry is AI-generated
during the release and reviewed (and freely editable) in the "Release HyperDX"
PR — keep the \`hyperdx-release-notes\` comment marker intact when editing.

## v2.33.0 — 2026-07-28

<!-- hyperdx-release-notes version=2.33.0 inputs=abc123def456 -->

Dashboards got faster.

### ✨ New Features

- **Drag-to-zoom**: select a region to zoom (#2695).

## v2.32.0 — 2026-07-01

<!-- hyperdx-release-notes version=2.32.0 inputs=oldhash000000 -->

An earlier release.
`;

describe('toChangelogBody', () => {
  it('drops the H1 and preamble, keeping every release section', () => {
    const body = toChangelogBody(ROOT_CHANGELOG);

    expect(body.startsWith('## v2.33.0 — 2026-07-28')).toBe(true);
    expect(body).not.toContain('# HyperDX Changelog');
    expect(body).not.toContain('Release-level highlights');
    expect(body).toContain('## v2.32.0 — 2026-07-01');
    expect(body).toContain('An earlier release.');
  });

  it('strips the release-notes markers', () => {
    expect(toChangelogBody(ROOT_CHANGELOG)).not.toContain(
      'hyperdx-release-notes',
    );
  });

  it('returns empty when there are no release sections yet', () => {
    // The preamble is addressed to maintainers ("keep the marker intact"), so
    // it must never be shown to users as if it were release notes.
    const seedOnly =
      '# HyperDX Changelog\n\nKeep the `hyperdx-release-notes` marker intact.\n';
    expect(toChangelogBody(seedOnly)).toBe('');
  });
});

describe('allowChangelogUrl', () => {
  it('permits https links to the allowed hosts', () => {
    const pr = 'https://github.com/hyperdxio/hyperdx/pull/1';
    expect(allowChangelogUrl(pr)).toBe(pr);
    expect(allowChangelogUrl('https://docs.hyperdx.io/x')).toBe(
      'https://docs.hyperdx.io/x',
    );
  });

  it('rejects every other target', () => {
    // The changelog body is model-authored from attacker-influenceable text, so
    // anything not explicitly allowed has to be dropped.
    for (const url of [
      'https://evil.example/phish',
      'http://github.com/x', // downgraded protocol
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      '//evil.example/x', // protocol-relative
      '/local/path', // relative
      'https://github.com.evil.example/x', // suffix confusion
      'https://notgithub.com/x',
      '',
      'not a url at all',
    ]) {
      expect(allowChangelogUrl(url)).toBe('');
    }
  });

  it('is not fooled by host casing', () => {
    // Hostnames are case-insensitive; URL normalises them to lower case.
    expect(allowChangelogUrl('https://GitHub.com/x')).toBe(
      'https://GitHub.com/x',
    );
  });
});
