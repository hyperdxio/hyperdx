import { buildAllowedHosts } from '@/mcp/app';

describe('buildAllowedHosts', () => {
  it('always includes the localhost defaults', () => {
    expect(buildAllowedHosts([])).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  it('adds the bare hostname of a configured URL (drops path and port)', () => {
    const hosts = buildAllowedHosts([
      'https://78fc-1-2-3.ngrok-free.app/mcp',
      'http://localhost:30287',
    ]);
    expect(hosts).toContain('78fc-1-2-3.ngrok-free.app');
    expect(hosts).toContain('localhost');
    // No port, no path leaked into the allowlist.
    expect(hosts).not.toContain('localhost:30287');
  });

  it('ignores undefined and malformed URLs rather than throwing', () => {
    expect(() => buildAllowedHosts([undefined, 'not a url', ''])).not.toThrow();
    expect(buildAllowedHosts([undefined, 'not a url'])).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
    ]);
  });
});
