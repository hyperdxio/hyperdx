import { allowChangelogUrl } from '@/components/AppNav/WhatsNewDrawer';

// The release summary is written during the release from changeset bodies,
// commit messages and PR titles, so its link targets are untrusted. The e2e test
// exercises this through react-markdown for real; these are the edge cases it is
// not worth booting a browser for.
describe('allowChangelogUrl', () => {
  it('passes through the hosts release notes are allowed to link', () => {
    expect(
      allowChangelogUrl('https://github.com/hyperdxio/hyperdx/pull/1'),
    ).toBe('https://github.com/hyperdxio/hyperdx/pull/1');
    expect(allowChangelogUrl('https://docs.hyperdx.io/formulas')).toBe(
      'https://docs.hyperdx.io/formulas',
    );
  });

  it('compares the whole hostname, so a lookalike is rejected', () => {
    // The reason this is a URL parse and not a prefix match.
    expect(allowChangelogUrl('https://github.com.evil.example/x')).toBe('');
    expect(allowChangelogUrl('https://notgithub.com/x')).toBe('');
  });

  it('accepts the forms a prefix match would wrongly reject', () => {
    // Kept in step with linkAllowed in .github/scripts/release-notes.mjs: these
    // resolve to an allowed host, so failing them here would redden the publish
    // job for a link that renders correctly.
    expect(allowChangelogUrl('https://github.com:443/x')).toBe(
      'https://github.com:443/x',
    );
    expect(allowChangelogUrl('https://user@github.com/x')).toBe(
      'https://user@github.com/x',
    );
  });

  it('rejects anything that is not https', () => {
    expect(allowChangelogUrl('http://github.com/x')).toBe('');
    expect(allowChangelogUrl('javascript:alert(1)')).toBe('');
    expect(allowChangelogUrl('data:text/html,<script>alert(1)</script>')).toBe(
      '',
    );
  });

  it('rejects a target with no host of its own', () => {
    // Resolved against a host that is never allowed, rather than the app's own
    // origin, so a relative or protocol-relative target cannot smuggle a link.
    expect(allowChangelogUrl('/settings')).toBe('');
    expect(allowChangelogUrl('//evil.example/x')).toBe('');
    expect(allowChangelogUrl('')).toBe('');
  });

  it('rejects a target it cannot parse', () => {
    expect(allowChangelogUrl('https://[not a url')).toBe('');
  });
});
