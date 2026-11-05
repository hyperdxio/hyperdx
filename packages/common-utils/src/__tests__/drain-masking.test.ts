import {
  DEFAULT_MASKING_INSTRUCTIONS,
  TemplateMinerConfig,
} from '@/drain/config';
import { LogMasker } from '@/drain/masking';
import { minePatterns } from '@/drain/mine-patterns';
import { TemplateMiner } from '@/drain/template-miner';

type Row = { body: string };

const mask = (s: string) =>
  LogMasker.fromConfig(new TemplateMinerConfig()).mask(s);

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

const pad = (n: number) => String(n).padStart(2, '0');

// One day of mixed logs: Java/log4j, access logs, syslog, klog, ISO-8601,
// HTTP, JavaScript and java.util.logging dates. As in real logs, every line
// has its own time and id.
// `day` is the day of November 2026; `weekday` its name.
const dayOfLogs = (day: number, weekday: string) => {
  let n = 0;
  const t = () => {
    n++;
    return `${pad(6 + Math.floor(n / 60))}:${pad(n % 60)}:${pad((n * 7) % 60)}`;
  };
  const hex = () =>
    `${pad(n % 100)}bf92f3577b34da6a3ce929d0e0e47${pad(n % 100)}`;
  return Array.from({ length: 12 }, (_, i) => [
    `2026-11-${pad(day)} ${t()},345 ${hex()} INFO started`,
    `2026-11-${pad(day)} ${t()},345 ${hex()} ERROR crashed`,
    `2026-11-${pad(day)} ${t()} ok`,
    `2026-11-${pad(day)} ${t()} queue_depth=${i}`,
    `[2026-11-${pad(day)} ${t()},345][pool-1-thread-${i}] INFO request handled ok`,
    `[${pad(day)}/Nov/2026:${t()} +0000] "GET /a" 200`,
    `[${pad(day)}/Nov/2026:${t()} +0000] "POST /b" 500`,
    `Nov ${String(day).padStart(2, ' ')} ${t()} host sshd[${100 + i}]: session opened`,
    `I11${pad(day)} ${t()}.345678 1 main.go:42] sync done`,
    `E11${pad(day)} ${t()}.345678 1 main.go:42] sync failed`,
    `2026-11-${pad(day)}T${t()}Z request ok`,
    `Date: ${weekday}, ${pad(day)} Nov 2026 ${t()} GMT`,
    `${weekday} Nov ${pad(day)} 2026 ${t()} GMT+0000 (Coordinated Universal Time) tick`,
    `Nov ${day}, 2026 ${t().replace(/^0/, '')} AM org.example.Main run`,
    `Started job at ${i % 2 ? 'boot' : 'shutdown'}`,
  ]).flat();
};

// Groups of line indices that a miner put in the same cluster.
const clusterGroups = (config: TemplateMinerConfig, lines: string[]) => {
  const miner = new TemplateMiner(config);
  const ids = lines.map(line => miner.addLogMessage(line).clusterId);
  const groups = new Map<number, number[]>();
  ids.forEach((id, i) => groups.set(id, [...(groups.get(id) ?? []), i]));
  return [...groups.values()].map(g => g.join(',')).sort();
};

describe('default masking', () => {
  it.each([
    ['2026-11-04T06:12:12.345Z started', '<DATE>T06:12:12.345Z started'],
    ['2026-11-04 06:12:12,345 INFO x', '<DATE> 06:12:12,345 INFO x'],
    [
      'run_id=scheduled__2026-11-04T06:00:00+00:00',
      'run_id=scheduled__<DATE>T06:00:00+00:00',
    ],
    [
      'Date: Wed, 04 Nov 2026 06:12:12 GMT',
      'Date: <DATE> <DATE> <DATE> <DATE> 06:12:12 GMT',
    ],
    ['[04/Nov/2026:06:12:12 +0000] "GET /"', '[<DATE>:06:12:12 +0000] "GET /"'],
    ['04-Nov-2026 06:12:12.345 INFO main', '<DATE> 06:12:12.345 INFO main'],
    ['Nov  4 06:12:12 host sshd', '<DATE>  <DATE> 06:12:12 host sshd'],
    ['I1104 06:12:12.345678 1 main.go', 'I<DATE> 06:12:12.345678 1 main.go'],
    ['I1104\t06:12:12.345678 1 main.go', 'I<DATE>\t06:12:12.345678 1 main.go'],
    [
      '26/11/04 16:09:18 WARN KafkaOffsetReader: retry',
      '<DATE> 16:09:18 WARN KafkaOffsetReader: retry',
    ],
    ['11/04/2026 06:12:12 x', '<DATE> 06:12:12 x'],
    ['Nov  4 06:12:12 2026-11-04 x', '<DATE>  <DATE> 06:12:12 <DATE> x'],
    [
      'Wed Nov  4 06:12:12 +0000 2026 x',
      '<DATE> <DATE>  <DATE> 06:12:12 +0000 <DATE> x',
    ],
    ['04.11.2026 06:12:12 x', '<DATE> 06:12:12 x'],
    [
      '04 Nov 2026 06:12:12,345 INFO job done',
      '<DATE> <DATE> <DATE> 06:12:12,345 INFO job done',
    ],
    ['partition 2026-11-04 loaded', 'partition <DATE> loaded'],
    ['wrote backup_2026-11-04.tar', 'wrote backup_<DATE>.tar'],
    [
      'Wed Nov  4 06:12:12 2026 job done',
      '<DATE> <DATE>  <DATE> 06:12:12 <DATE> job done',
    ],
    [
      'at Wed Nov 04 06:12:12 UTC 2026 done',
      'at <DATE> <DATE> <DATE> 06:12:12 UTC <DATE> done',
    ],
    ['2026/11/04 06:12:12 server started', '<DATE> 06:12:12 server started'],
    [
      'Wed Nov 04 2026 06:12:12 GMT+0000 (Coordinated Universal Time) tick',
      '<DATE> <DATE> <DATE> <DATE> 06:12:12 GMT+0000 (Coordinated Universal Time) tick',
    ],
    [
      'Nov 4, 2026 6:12:12 PM org.example.Main run',
      '<DATE> <DATE> <DATE> 6:12:12 PM org.example.Main run',
    ],
    [
      '[2026-11-04 06:12:12,345][pool-1-thread-3] INFO ok',
      '[<DATE> 06:12:12,345][pool-1-thread-3] INFO ok',
    ],
  ])('masks %s', (input, expected) => {
    expect(mask(input)).toBe(expected);
  });

  it.each([
    'version v1.2.3 build 2026',
    'flags 0x1f and 0xdeadbeef',
    'commit abc1234 on main',
    'took 12.345 ms at 10:30',
    'Sun is shining on 4 hosts',
    'Meeting on Mon at noon',
    'sent 5 Mar items ok',
    'F1234 not a klog date',
    '06:12:12 GET 2048 bytes',
    'trace 4bf92f3577b34da6a3ce929d0e0e4736 ok',
    'req 123e4567-e89b-12d3-a456-426614174000 done',
    'release 10.11.2026 notes',
    'part 1234-56-78 x',
    'ip 10.11.12.13 06:12:12 up',
  ])('leaves %s alone', input => {
    expect(mask(input)).toBe(input);
  });

  it('masks a drain3-style instruction once per match unless perWord is set', () => {
    const config = new TemplateMinerConfig();
    config.maskingInstructions = [{ pattern: '\\d+ ms', maskWith: 'DUR' }];
    expect(LogMasker.fromConfig(config).mask('took 12 ms')).toBe('took <DUR>');
    config.maskingInstructions = [
      { pattern: '\\d+ ms', maskWith: 'DUR', perWord: true },
    ];
    expect(LogMasker.fromConfig(config).mask('took 12 ms')).toBe(
      'took <DUR> <DUR>',
    );
  });

  it('never changes the word count of a line', () => {
    for (const line of dayOfLogs(4, 'Wed')) {
      expect(mask(line).trim().split(/\s+/)).toHaveLength(
        line.trim().split(/\s+/).length,
      );
    }
  });

  it('stays linear on long runs of whitespace', () => {
    // A lookbehind that ends in \s+ rescans the run at every position: 128 KiB
    // took seconds that way.
    const run = ' '.repeat(1 << 17);
    const start = performance.now();
    expect(mask(`Nov  4 06:12:12${run}2026`)).toBe(
      `<DATE>  <DATE> 06:12:12${run}<DATE>`,
    );
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('lets extractParameters read a per-word masked date back', () => {
    const miner = new TemplateMiner();
    const line = 'Date: Wed, 04 Nov 2026 06:12:12 GMT';
    const { templateMined } = miner.addLogMessage(line);
    expect(
      miner.extractParameters(templateMined, line)?.map(p => p.value),
    ).toEqual(['Wed,', '04', 'Nov', '2026']);
  });

  it('is on by default', () => {
    expect(new TemplateMinerConfig().maskingInstructions).toEqual(
      DEFAULT_MASKING_INSTRUCTIONS,
    );
  });

  it('is off for a drain3 JSON config that lists no masks, as in drain3', () => {
    expect(TemplateMinerConfig.fromJSON({}).maskingInstructions).toEqual([]);
  });

  it('takes the masks a drain3 JSON config lists', () => {
    expect(
      TemplateMinerConfig.fromJSON({
        masking_instructions: [{ regex_pattern: '\\d+', mask_with: 'NUM' }],
      }).maskingInstructions,
    ).toEqual([{ pattern: '\\d+', maskWith: 'NUM' }]);
  });
});

describe('patterns with the default masks', () => {
  it('cluster one day of logs as without masks', () => {
    const unmasked = new TemplateMinerConfig();
    unmasked.maskingInstructions = [];
    const isKlog = (line: string) => /^[IWEF]\d{4} /.test(line);
    const lines = dayOfLogs(4, 'Wed').filter(line => !isKlog(line));
    expect(clusterGroups(new TemplateMinerConfig(), lines)).toEqual(
      clusterGroups(unmasked, lines),
    );
  });

  it('keeps klog severities apart, which unmasked mining merges', () => {
    // Unmasked, I1104 and E1104 both route as numbers in Drain's prefix tree;
    // masked, I<DATE> and E<DATE> route by their severity letter.
    const lines = dayOfLogs(4, 'Wed').filter(line => /^[IE]\d{4} /.test(line));
    expect(
      mine(lines)
        .map(p => p.pattern)
        .sort(),
    ).toEqual([
      'E<DATE> <*> 1 main.go:42] sync failed',
      'I<DATE> <*> 1 main.go:42] sync done',
    ]);
  });

  it('give the last day of a month and the first of the next the same templates', () => {
    const templates = (day: string, weekday: string, rfcDay: string) =>
      mine([
        `${day} 06:12:11 host sshd[41]: session opened`,
        `Date: ${weekday}, ${rfcDay} 2026 06:12:11 GMT`,
        `${weekday} ${day} 06:12:11 2026 job done`,
        `${rfcDay} 2026 06:12:11,345 INFO job done`,
      ])
        .map(p => p.pattern)
        .sort();
    expect(templates('Oct 31', 'Sat', '31 Oct')).toEqual(
      templates('Nov  1', 'Sun', '01 Nov'),
    );
  });

  it('give the logs of two different days the same templates', () => {
    const templates = (lines: string[]) =>
      mine(lines)
        .map(p => p.pattern)
        .sort();
    const day1 = templates(dayOfLogs(3, 'Tue'));
    const day2 = templates(dayOfLogs(4, 'Wed'));
    expect(day1).toEqual(day2);
    expect(day1.join('\n')).not.toMatch(/2026|Nov|Tue|Wed|[IE]110/);
  });
});
