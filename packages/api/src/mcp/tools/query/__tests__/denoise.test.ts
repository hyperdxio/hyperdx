import { minePatterns } from '@hyperdx/common-utils/dist/drain';

import { buildNoisyBodyMatcher } from '@/mcp/tools/query/denoise';

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

const wildcards = (template: string) =>
  template.split(/\s+/).filter(t => t === '<*>').length;

describe('buildNoisyBodyMatcher', () => {
  const startDate = new Date('2026-01-01T00:00:00Z');
  const endDate = new Date('2026-01-01T01:00:00Z');

  it('removes members of a noisy cluster unless a non-noisy template fits them more specifically', () => {
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
      const templates = patterns.map(p => p.pattern);
      for (const noisy of patterns) {
        const isNoisy = buildNoisyBodyMatcher(
          templates,
          new Set([noisy.pattern]),
        );
        const own = wildcards(noisy.pattern);
        for (const { body } of noisy.samples) {
          const tokens = body.split(' ');
          const moreSpecific = templates.some(t => {
            const tt = t.split(' ');
            return (
              t !== noisy.pattern &&
              wildcards(t) < own &&
              tt.length === tokens.length &&
              tt.every((tok, i) => tok === '<*>' || tok === tokens.at(i))
            );
          });
          if (isNoisy(body) === moreSpecific) {
            throw new Error(
              `seed ${seed}: "${body}" in noisy "${noisy.pattern}" ` +
                `removed=${isNoisy(body)}`,
            );
          }
        }
      }
    }
  });

  it('keeps rows of a specific cluster when a broad template is noisy', () => {
    const isNoisy = buildNoisyBodyMatcher(
      ['<*> <*>', 'user login'],
      new Set(['<*> <*>']),
    );
    expect(isNoisy('foo bar')).toBe(true);
    expect(isNoisy('user login')).toBe(false);
  });

  it('keeps bodies that do not fit a noisy template', () => {
    const templates = [
      'heartbeat ok <*>',
      'GET <*> <*> ok 200',
      'GET user <*> <*> <*>',
      'user <*> logged in',
    ];
    const isNoisy = buildNoisyBodyMatcher(
      templates,
      new Set(['heartbeat ok <*>', 'GET <*> <*> ok 200']),
    );
    expect(isNoisy('heartbeat ok 999')).toBe(true);
    expect(isNoisy('  GET api a ok 200 ')).toBe(true);
    expect(isNoisy('user 7 logged in')).toBe(false);
    expect(isNoisy('heartbeat ok')).toBe(false);
    expect(isNoisy('GET user p q r')).toBe(false);
    expect(isNoisy('something unseen')).toBe(false);
  });

  it('prefers the noisy template on a tie', () => {
    const isNoisy = buildNoisyBodyMatcher(
      ['a <*> c', 'a b <*>'],
      new Set(['a b <*>']),
    );
    expect(isNoisy('a b c')).toBe(true);
  });
});
