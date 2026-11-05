import {
  DEFAULT_MASKING_INSTRUCTIONS,
  TemplateMinerConfig,
} from '@/drain/config';
import { LogMasker, MaskingInstruction } from '@/drain/masking';
import { minePatterns } from '@/drain/mine-patterns';

type Row = { body: string };

const mask = (s: string) =>
  new LogMasker(
    DEFAULT_MASKING_INSTRUCTIONS.map(
      mi => new MaskingInstruction(mi.pattern, mi.maskWith),
    ),
    '<',
    '>',
  ).mask(s);

const mine = (bodies: string[]) =>
  minePatterns<Row>(
    bodies.map(body => ({ body })),
    {
      totalCount: bodies.length,
      startDate: new Date('2026-11-03T00:00:00Z'),
      endDate: new Date('2026-11-05T00:00:00Z'),
      trendBuckets: 1,
      getBody: r => r.body,
      getTimestamp: () => null,
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
    ['2026-11-04T06:12:12.345Z started', '<TS> started'],
    ['2026-11-04 06:12:12,345 INFO x', '<TS> INFO x'],
    ['at 2026-11-04T06:12:12+01:00 done', 'at <TS> done'],
    ['run_id=scheduled__2026-11-04T06:00:00+00:00', 'run_id=scheduled__<TS>'],
    ['Date: Wed, 04 Nov 2026 06:12:12 GMT', 'Date: <TS>'],
    ['[04/Nov/2026:06:12:12 +0000] "GET /"', '[<TS>] "GET /"'],
    ['Nov  4 06:12:12 host sshd', '<TS> host sshd'],
    ['I1104 06:12:12.345678 1 main.go', '<TS> <TS> 1 main.go'],
    [
      '26/11/04 16:09:18 WARN KafkaOffsetReader: retry',
      '<TS> <TS> WARN KafkaOffsetReader: retry',
    ],
    ['04 Nov 2026 06:12:12,345 INFO job done', '<TS> INFO job done'],
    ['partition 2026-11-04 loaded', 'partition <TS> loaded'],
    ['wrote backup_2026-11-04.tar', 'wrote backup_<TS>.tar'],
    ['Wed Nov  4 06:12:12 2026 job done', '<TS> job done'],
    ['at Wed Nov 04 06:12:12 UTC 2026 done', 'at <TS> done'],
    ['Date: Wed, 4 Nov 2026 06:12:12 GMT', 'Date: <TS>'],
    ['2026/11/04 06:12:12 server started', '<TS> <TS> server started'],
    ['span_4bf92f3577b34da6a3ce929d0e0e4736 ok', 'span_<ID> ok'],
    ['req_123e4567-e89b-12d3-a456-426614174000 done', 'req_<ID> done'],
    ['id 123e4567-e89b-12d3-a456-426614174000 ok', 'id <ID> ok'],
    ['trace 4bf92f3577b34da6a3ce929d0e0e4736 ok', 'trace <ID> ok'],
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

  it('is off for a drain3 JSON config that lists no masks, as in drain3', () => {
    expect(TemplateMinerConfig.fromJSON({}).maskingInstructions).toEqual([]);
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
});
