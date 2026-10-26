import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { RunRecord } from '@/harness/types';
import type {
  HyperdxApiClient,
  OpenIncidentInput,
  ResolveIncidentInput,
} from '@/hyperdx/api';
import { relatedIncidents } from '@/scenarios/smokehouse/families';
import { GROUND_TRUTH } from '@/scenarios/smokehouse/groundTruth';
import {
  clearMemory,
  EVAL_TITLE_PREFIX,
  seedMemory,
  selfRecord,
  syntheticRecord,
} from '@/scenarios/smokehouse/memory';
import { SMOKEHOUSE_SCENARIOS } from '@/scenarios/smokehouse/scenario';

const SCENARIO = 'sh-cache-stampede';
const gt = GROUND_TRUTH['cache-stampede'];

function mockApi() {
  let n = 0;
  return {
    openIncident: jest.fn(async (_i: OpenIncidentInput) => ({
      incident_id: `id-${++n}`,
    })),
    recordAction: jest.fn(async () => ({})),
    resolveIncident: jest.fn(
      async (_id: string, _i: ResolveIncidentInput) => ({}),
    ),
    confirmIncident: jest.fn(async () => ({})),
    deleteIncidents: jest.fn(async () => 0),
  };
}
const asClient = (m: ReturnType<typeof mockApi>) =>
  m as unknown as HyperdxApiClient;

function runRecord(over: Partial<RunRecord>): RunRecord {
  return {
    scenario: 'sh-x',
    startedAt: '2026-01-01T00:00:00.000Z',
    finalAnswer: 'It was the cache.',
    toolCalls: [],
    ...over,
  } as RunRecord;
}

describe('syntheticRecord', () => {
  const rec = syntheticRecord(gt);

  it('describes the incident from ground truth', () => {
    expect(rec.open.title).toBe(
      `${EVAL_TITLE_PREFIX(SCENARIO)} cache-stampede`,
    );
    expect(rec.open.alertingService).toBe('edge-gateway');
    expect(rec.open.symptomKeys).toContain('service:cart');
    expect(rec.open.symptomKeys).toContain('mechanism:slow_datastore');
    for (const k of rec.open.symptomKeys ?? []) {
      expect(k).toMatch(/^[a-z_]+:.+$/);
    }
    expect(rec.resolve.rootCauseNode).toBe('service:cart');
    expect(rec.resolve.rootCause).toBe(gt.expected.summary);
  });

  it('has a query and a note action with outcomes', () => {
    expect(rec.actions).toHaveLength(2);
    expect(rec.actions[0]).toMatchObject({
      actionType: 'query',
      tool: 'clickstack_event_deltas',
      args: { service: 'cart' },
    });
    expect(rec.actions[1].actionType).toBe('note');
    expect(rec.resolve.outcomes).toEqual([
      { seq: 1, outcome: 'led_to_fix' },
      { seq: 2, outcome: 'useful' },
    ]);
  });

  it('sanitises mechanism labels into valid keys', () => {
    const odd = {
      ...gt,
      mechanisms: { cart: ['Slow Datastore!'] },
    };
    expect(syntheticRecord(odd).open.symptomKeys).toContain(
      'mechanism:slow_datastore_',
    );
  });
});

const call = (name: string, input: unknown, isError = false) => ({
  name: `mcp__clickstack__${name}`,
  input,
  output: 'rows',
  isError,
});
const own = {
  open: call('clickstack_open_incident', {
    title: 'Checkout slow',
    alertingService: 'checkout',
    symptomKeys: ['service:payments', 'bad key'],
  }),
  query: call('clickstack_table', { service: 'payments' }),
  failed: call('clickstack_sql', { sql: 'x' }, true),
  record: call('clickstack_record_incident_action', {
    actionType: 'query',
    tool: 'clickstack_table',
    args: { service: 'payments' },
    summary: 's',
  }),
  resolve: call('clickstack_resolve_incident', {
    rootCause: 'payments pool exhausted',
    rootCauseNode: 'service:payments',
    resolution: 'raise pool',
    outcomes: [{ seq: 1, outcome: 'dead_end' }],
  }),
};
const ownCalls = [own.open, own.query, own.failed, own.record, own.resolve];

describe('selfRecord', () => {
  it('replays the agent own brief, not ground truth', () => {
    const rec = selfRecord(
      runRecord({ toolCalls: ownCalls as RunRecord['toolCalls'] }),
      gt,
    );
    expect(gt.expected.originService).toBe('cart');
    expect(rec.open.title).toBe(`${EVAL_TITLE_PREFIX(SCENARIO)} Checkout slow`);
    expect(rec.open.alertingService).toBe('checkout');
    expect(rec.open.symptomKeys).toEqual(['service:payments']);
    expect(rec.resolve.rootCauseNode).toBe('service:payments');
    expect(rec.resolve.rootCause).toBe('payments pool exhausted');
  });

  it('maps outcomes by position over successful record calls only', () => {
    const rec = (summary: string) =>
      call('clickstack_record_incident_action', {
        incidentId: 'x',
        actionType: 'hypothesis',
        reason: 'why',
        summary,
      });
    const rr = runRecord({
      toolCalls: [
        own.open,
        rec('first'),
        call('clickstack_record_incident_action', { summary: 'bad' }, true),
        rec('second'),
        call('clickstack_resolve_incident', {
          rootCause: 'rc',
          rootCauseNode: 'service:payments',
          resolution: 'r',
          outcomes: [
            { seq: 2, outcome: 'useful' },
            { seq: 3, outcome: 'dead_end' },
          ],
        }),
      ] as RunRecord['toolCalls'],
    });
    const r = selfRecord(rr, gt);
    expect(r.actions).toEqual([
      { actionType: 'hypothesis', reason: 'why', summary: 'first' },
      { actionType: 'hypothesis', reason: 'why', summary: 'second' },
    ]);
    expect(r.resolve.outcomes).toEqual([{ seq: 2, outcome: 'useful' }]);
    expect(r.droppedOutcomes).toBe(1);
  });

  it('falls back to its own tool calls with unknown outcomes', () => {
    const rec = selfRecord(
      runRecord({
        toolCalls: [
          own.query,
          own.failed,
          own.resolve,
        ] as RunRecord['toolCalls'],
      }),
      gt,
    );
    expect(rec.actions.map(a => [a.tool, a.actionType])).toEqual([
      ['clickstack_table', 'query'],
      ['clickstack_sql', 'note'],
    ]);
    expect(rec.resolve.outcomes).toEqual([
      { seq: 1, outcome: 'unknown' },
      { seq: 2, outcome: 'unknown' },
    ]);
  });
});

describe('seedMemory', () => {
  const related = relatedIncidents('cache-stampede');

  it('seeds and confirms related incidents', async () => {
    const api = mockApi();
    const n = await seedMemory(asClient(api), SCENARIO, 'related', '/nope');
    expect(related.length).toBeGreaterThan(0);
    expect(n).toBe(related.length);
    expect(api.deleteIncidents).toHaveBeenCalledWith(
      EVAL_TITLE_PREFIX(SCENARIO),
    );
    expect(api.openIncident).toHaveBeenCalledTimes(related.length);
    expect(api.resolveIncident).toHaveBeenCalledTimes(related.length);
    expect(api.confirmIncident).toHaveBeenCalledTimes(related.length);
    expect(
      api.openIncident.mock.calls[0][0].title.startsWith(
        `${EVAL_TITLE_PREFIX(SCENARIO)} `,
      ),
    ).toBe(true);
  });

  it('posts nothing for none', async () => {
    const api = mockApi();
    expect(await seedMemory(asClient(api), SCENARIO, 'none', '/nope')).toBe(0);
    expect(api.openIncident).not.toHaveBeenCalled();
  });

  describe('self mode', () => {
    let dir: string;
    let cell: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'memory-'));
      cell = join(dir, 'batch1', `sh-${related[0]}`, 'clickstack', 'm', 'none');
      mkdirSync(cell, { recursive: true });
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const write = (file: string, over: Partial<RunRecord>) =>
      writeFileSync(
        join(cell, file),
        JSON.stringify(
          runRecord({
            scenario: `sh-${related[0]}`,
            toolCalls: ownCalls as RunRecord['toolCalls'],
            ...over,
          }),
        ),
      );

    it('seeds from the newest qualifying run and never confirms', async () => {
      write('0.json', { startedAt: '2026-01-01T00:00:00.000Z' });
      write('1.json', {
        startedAt: '2026-02-01T00:00:00.000Z',
        toolCalls: [
          ...ownCalls,
          call('clickstack_resolve_incident', {
            rootCause: 'newer',
            rootCauseNode: 'service:payments',
            resolution: 'r',
          }),
        ] as RunRecord['toolCalls'],
      });
      writeFileSync(join(cell, '2.json'), '{not json');
      const api = mockApi();
      expect(await seedMemory(asClient(api), SCENARIO, 'self', dir)).toBe(1);
      expect(api.resolveIncident.mock.calls[0][1].rootCause).toBe('newer');
      expect(api.confirmIncident).not.toHaveBeenCalled();
    });

    it('skips runs with no resolve call or seeded memory', async () => {
      write('0.json', { toolCalls: [] });
      write('1.json', { memoryMode: 'related' });
      const api = mockApi();
      expect(await seedMemory(asClient(api), SCENARIO, 'self', dir)).toBe(0);
      expect(api.openIncident).not.toHaveBeenCalled();
    });
  });

  it('warns when clearing finds existing incidents', async () => {
    const api = mockApi();
    api.deleteIncidents.mockResolvedValue(3);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await seedMemory(asClient(api), SCENARIO, 'none', '/nope');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cleared 3'));
    warn.mockRestore();
  });
});

describe('clearMemory', () => {
  it('deletes by the scenario title prefix', async () => {
    const api = mockApi();
    await clearMemory(asClient(api), SCENARIO);
    expect(api.deleteIncidents).toHaveBeenCalledWith(
      EVAL_TITLE_PREFIX(SCENARIO),
    );
  });

  it('uses an opaque prefix that does not name the incident', () => {
    expect(EVAL_TITLE_PREFIX(SCENARIO)).toMatch(/^\[eval:sh_[0-9a-f]{8}\]$/);
  });
});

describe('smokehouse scenario hooks', () => {
  const s = SMOKEHOUSE_SCENARIOS[SCENARIO];

  it('adds recording instructions to the default prompt', () => {
    const p = s.buildSystemPrompt!({
      tables: { traces: 't', logs: 'l' },
    });
    expect(p).toContain('You are an SRE');
    expect(p).toContain('clickstack_open_incident');
    expect(p).toContain('clickstack_resolve_incident');
  });

  it('has prepare and cleanup hooks', () => {
    expect(s.prepare).toBeInstanceOf(Function);
    expect(s.cleanup).toBeInstanceOf(Function);
  });
});
