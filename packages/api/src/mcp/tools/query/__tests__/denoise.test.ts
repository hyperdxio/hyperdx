import { minePatterns } from '@hyperdx/common-utils/dist/drain';

import { buildNoisyBodyMatcher } from '@/mcp/tools/query/denoise';

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe('buildNoisyBodyMatcher', () => {
  const startDate = new Date('2026-01-01T00:00:00Z');
  const endDate = new Date('2026-01-01T01:00:00Z');

  it('matches every sampled member of a noisy cluster', () => {
    // Short random bodies over a small vocabulary produce same-length
    // clusters that overlap, where `match` sends a member elsewhere.
    const words = ['a', 'b', 'c', 'ok', 'fail', 'x1', 'y2', '42', 'retry'];
    for (let seed = 1; seed <= 50; seed++) {
      const rand = lcg(seed);
      const bodies = Array.from({ length: 300 }, () =>
        Array.from(
          { length: 2 + Math.floor(rand() * 3) },
          () => words[Math.floor(rand() * words.length)],
        ).join(' '),
      );
      const { patterns } = minePatterns(
        bodies.map(body => ({ body })),
        {
          totalCount: bodies.length,
          startDate,
          endDate,
          trendBuckets: 0,
          maxSamples: bodies.length,
          getBody: row => row.body,
          getTimestamp: () => startDate.getTime(),
        },
      );
      for (const noisy of patterns) {
        const isNoisy = buildNoisyBodyMatcher(new Set([noisy.pattern]));
        for (const { body } of noisy.samples) {
          if (!isNoisy(body)) {
            throw new Error(
              `seed ${seed}: "${body}" in noisy "${noisy.pattern}" was kept`,
            );
          }
        }
      }
    }
  });

  it('keeps bodies that do not fit a noisy template', () => {
    const isNoisy = buildNoisyBodyMatcher(
      new Set(['heartbeat ok <*>', 'GET <*> <*> ok 200']),
    );
    expect(isNoisy('heartbeat ok 999')).toBe(true);
    expect(isNoisy('  GET api a ok 200 ')).toBe(true);
    expect(isNoisy('user 7 logged in')).toBe(false);
    expect(isNoisy('heartbeat ok')).toBe(false);
    // Drain can match this to a cluster that a noisy member also matches;
    // it does not fit the noisy template, so it stays.
    expect(isNoisy('GET user p q r')).toBe(false);
  });
});
