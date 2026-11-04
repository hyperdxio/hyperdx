import {
  DEFAULT_MASKING_INSTRUCTIONS,
  TemplateMinerConfig,
} from '@/drain/config';
import { LogMasker, MaskingInstruction } from '@/drain/masking';
import { minePatterns } from '@/drain/mine-patterns';
import { TemplateMiner } from '@/drain/template-miner';

type Row = { body: string };

const mask = (s: string) =>
  new LogMasker(
    DEFAULT_MASKING_INSTRUCTIONS.map(
      mi => new MaskingInstruction(mi.pattern, mi.maskWith),
    ),
    '<',
    '>',
  ).mask(s);

const mine = (bodies: string[], miner?: TemplateMiner) =>
  minePatterns<Row>(
    bodies.map(body => ({ body })),
    {
      totalCount: bodies.length,
      startDate: new Date('2026-11-03T00:00:00Z'),
      endDate: new Date('2026-11-05T00:00:00Z'),
      trendBuckets: 1,
      getBody: r => r.body,
      getTimestamp: () => null,
      miner,
    },
  ).patterns;

// The same job failing at a different time and account on each line.
const linesOn = (day: string) =>
  Array.from(
    { length: 50 },
    (_, i) =>
      `${day} 06:${String(i % 60).padStart(2, '0')}:12.345 ERROR [worker-3] c.e.SyncJob - Sync failed for account ${1000 + i}: HTTP 500`,
  );

describe('default masking', () => {
  it.each([
    ['2026-11-04T06:12:12.345Z started', '<*> started'],
    ['2026-11-04 06:12:12,345 INFO x', '<*> INFO x'],
    ['at 2026-11-04T06:12:12+01:00 done', 'at <*> done'],
    ['run_id=scheduled__2026-11-04T06:00:00+00:00', 'run_id=scheduled__<*>'],
    ['Date: Wed, 04 Nov 2026 06:12:12 GMT', 'Date: <*>'],
    ['[04/Nov/2026:06:12:12 +0000] "GET /"', '[<*>] "GET /"'],
    ['Nov  4 06:12:12 host sshd', '<*> host sshd'],
    ['I1104 06:12:12.345678 1 main.go', 'I1104 <*> 1 main.go'],
    ['partition 2026-11-04 loaded', 'partition <*> loaded'],
    ['id 123e4567-e89b-12d3-a456-426614174000 ok', 'id <*> ok'],
    ['trace 4bf92f3577b34da6a3ce929d0e0e4736 ok', 'trace <*> ok'],
  ])('masks %s', (input, expected) => {
    expect(mask(input)).toBe(expected);
  });

  it.each([
    'version v1.2.3 build 2026',
    'flags 0x1f and 0xdeadbeef',
    'commit abc1234 on main',
    'took 12.345 ms at 10:30',
  ])('leaves %s alone', input => {
    expect(mask(input)).toBe(input);
  });

  it('is on by default', () => {
    expect(new TemplateMinerConfig().maskingInstructions).toEqual(
      DEFAULT_MASKING_INSTRUCTIONS,
    );
  });
});

describe('patterns across days', () => {
  it('gives dated lines from two days the same template', () => {
    const day1 = mine(linesOn('2026-11-03'));
    const day2 = mine(linesOn('2026-11-04'));
    expect(day1).toHaveLength(1);
    expect(day2).toHaveLength(1);
    expect(day1[0].pattern).toBe(day2[0].pattern);
    expect(day1[0].pattern).not.toContain('2026-11-0');
  });

  it('puts a token that varies in only one window into one cluster with a shared miner', () => {
    const constant = Array.from(
      { length: 20 },
      () => 'connect failed host=db-1 retry later',
    );
    const varying = Array.from(
      { length: 20 },
      (_, i) => `connect failed host=db-${i} retry later`,
    );
    // Separate trees: the token stays literal in one window and becomes <*>
    // in the other, so the templates differ.
    expect(mine(constant)[0].pattern).not.toBe(mine(varying)[0].pattern);

    const miner = new TemplateMiner(new TemplateMinerConfig());
    const baseline = mine(constant, miner);
    const current = mine(varying, miner);
    expect(miner.drain.clusterCount).toBe(1);
    expect(current.map(p => p.id)).toEqual(baseline.map(p => p.id));
  });

  it('still tells new and gone patterns apart with one shared miner', () => {
    const miner = new TemplateMiner(new TemplateMinerConfig());
    const baseline = mine(
      [...linesOn('2026-11-03'), 'cache warmed in 120 ms'],
      miner,
    );
    const current = mine(
      [...linesOn('2026-11-04'), 'disk quota exceeded on /data volume'],
      miner,
    );
    const baseIds = new Set(baseline.map(p => p.id));
    const curIds = new Set(current.map(p => p.id));
    const onlyCur = current.filter(p => !baseIds.has(p.id));
    const onlyBase = baseline.filter(p => !curIds.has(p.id));
    expect(onlyCur.map(p => p.pattern)).toEqual([
      'disk quota exceeded on /data volume',
    ]);
    expect(onlyBase.map(p => p.pattern)).toEqual(['cache warmed in 120 ms']);
  });
});
