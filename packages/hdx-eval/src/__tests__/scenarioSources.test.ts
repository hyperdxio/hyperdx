import { publicScenarioName, scenarioTables } from '@/clickhouse/schema';
import { buildInvestigationSystemPrompt } from '@/harness/systemPrompt';
import {
  HyperdxApiClient,
  type HyperdxSource,
  type KnowledgeSettings,
} from '@/hyperdx/api';
import { SETUP_SCENARIO_NAMES } from '@/hyperdx/setup';
import { ensureScenarioSources } from '@/hyperdx/sources';
import { SCENARIO_NAMES } from '@/scenarios';
import { EVAL_TITLE_PREFIX } from '@/scenarios/smokehouse/memory';
import { SMOKEHOUSE_SCENARIOS } from '@/scenarios/smokehouse/scenario';
import type { MemoryMode, PrepareContext } from '@/scenarios/types';

const SCENARIO = 'sh-cache-stampede';

describe('opaque smokehouse names', () => {
  it('keeps the incident name out of table names and the system prompt', () => {
    const t = scenarioTables(SCENARIO);
    expect(t.traces).toMatch(/^eval_sh_[0-9a-f]{8}_otel_traces$/);
    expect(JSON.stringify(t)).not.toContain('cache');
    const prompt = buildInvestigationSystemPrompt(SCENARIO);
    expect(prompt).toContain(t.traces);
    expect(prompt).not.toContain('cache');
  });

  it('gives every smokehouse scenario a distinct slug', () => {
    const slugs = Object.keys(SMOKEHOUSE_SCENARIOS).map(publicScenarioName);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('leaves other scenarios unchanged', () => {
    expect(publicScenarioName('error-root-cause')).toBe('error-root-cause');
    expect(scenarioTables('error-root-cause').traces).toBe(
      'eval_error_root_cause_otel_traces',
    );
  });
});

describe('setup-hyperdx scenarios', () => {
  it('skips the sh- family and keeps the rest', () => {
    expect(SETUP_SCENARIO_NAMES.some(n => n.startsWith('sh-'))).toBe(false);
    expect(SETUP_SCENARIO_NAMES).toContain('error-root-cause');
    expect(SETUP_SCENARIO_NAMES.length).toBeLessThan(SCENARIO_NAMES.length);
  });
});

function fakeSources(initial: HyperdxSource[] = []) {
  let sources = [...initial];
  let n = 0;
  const create = jest.fn(async (body: Record<string, unknown>) => {
    const s = { ...body, id: `src-${++n}` } as unknown as HyperdxSource;
    sources.push(s);
    return s;
  });
  return {
    create,
    get: () => sources,
    set: (s: HyperdxSource[]) => (sources = s),
  };
}

describe('ensureScenarioSources', () => {
  it('creates trace, log and metric sources once, reusing them by name', async () => {
    const f = fakeSources();
    const api = { createSource: f.create };
    const first = await ensureScenarioSources(
      api,
      'error-root-cause',
      'conn',
      f.get(),
    );
    expect(first.created).toEqual([
      'eval-error-root-cause-traces',
      'eval-error-root-cause-logs',
      'eval-error-root-cause-metrics',
    ]);
    const metric = f.get()[2] as unknown as { logSourceId: string };
    expect(metric.logSourceId).toBe(first.ids.logsSourceId);

    const again = await ensureScenarioSources(
      api,
      'error-root-cause',
      'conn',
      f.get(),
    );
    expect(again.created).toEqual([]);
    expect(again.ids).toEqual(first.ids);
    expect(f.create).toHaveBeenCalledTimes(3);
  });
});

describe('smokehouse prepare and cleanup', () => {
  const s = SMOKEHOUSE_SCENARIOS[SCENARIO];
  const proto = HyperdxApiClient.prototype;
  let f: ReturnType<typeof fakeSources>;
  let put: jest.SpyInstance;
  let deleteIncidents: jest.SpyInstance;
  let openIncident: jest.SpyInstance;

  beforeEach(() => {
    f = fakeSources();
    jest.spyOn(proto, 'listSourcesV2').mockImplementation(async () => f.get());
    jest.spyOn(proto, 'createSourceV2').mockImplementation(f.create);
    jest.spyOn(proto, 'deleteSourceV2').mockImplementation(async id => {
      f.set(f.get().filter(x => x.id !== id));
    });
    put = jest.spyOn(proto, 'putKnowledgeSettings').mockImplementation(
      async (b): Promise<KnowledgeSettings> => ({
        traceSourceId: b.traceSourceId ?? null,
        includeUnconfirmed: b.includeUnconfirmed ?? false,
      }),
    );
    deleteIncidents = jest.spyOn(proto, 'deleteIncidents').mockResolvedValue(0);
    openIncident = jest
      .spyOn(proto, 'openIncident')
      .mockResolvedValue({ incident_id: 'i' });
    jest.spyOn(proto, 'recordAction').mockResolvedValue({ seq: 1 });
    jest.spyOn(proto, 'resolveIncident').mockResolvedValue({});
    jest.spyOn(proto, 'confirmIncident').mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  const ctx = (memoryMode: MemoryMode): PrepareContext => ({
    memoryMode,
    apiUrl: 'http://api',
    accessKey: 'key',
    connectionId: 'conn',
    runsDir: '/nope',
  });
  const traceSource = () => f.get().find(x => x.kind === 'trace')!;

  it.each([
    ['none', false],
    ['related', false],
    ['misleading', false],
    ['self', true],
  ] as const)(
    'pins the scenario trace source in %s mode',
    async (mode, includeUnconfirmed) => {
      await s.prepare!(ctx(mode));
      expect(f.get().map(x => x.kind)).toEqual(['trace', 'log', 'metric']);
      expect(traceSource().name).toBe(
        `eval-${publicScenarioName(SCENARIO)}-traces`,
      );
      expect(traceSource().name).not.toContain('cache');
      expect(put).toHaveBeenCalledWith({
        traceSourceId: traceSource().id,
        includeUnconfirmed,
      });
    },
  );

  it('pins before seeding memory', async () => {
    await s.prepare!(ctx('related'));
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(
      openIncident.mock.invocationCallOrder[0],
    );
  });

  it('clears memory, unpins and removes only its own sources', async () => {
    await s.prepare!(ctx('related'));
    const other = {
      id: 'other',
      name: 'eval-error-root-cause-traces',
      kind: 'trace',
    } as unknown as HyperdxSource;
    f.set([...f.get(), other]);
    await s.cleanup!(ctx('related'));
    expect(deleteIncidents).toHaveBeenLastCalledWith(
      EVAL_TITLE_PREFIX(SCENARIO),
    );
    expect(put).toHaveBeenLastCalledWith({
      traceSourceId: null,
      includeUnconfirmed: false,
    });
    expect(f.get()).toEqual([other]);
  });

  it('still unpins and removes sources when clearing memory fails', async () => {
    await s.prepare!(ctx('none'));
    deleteIncidents.mockRejectedValueOnce(new Error('boom'));
    await expect(s.cleanup!(ctx('none'))).rejects.toThrow('boom');
    expect(put).toHaveBeenLastCalledWith({
      traceSourceId: null,
      includeUnconfirmed: false,
    });
    expect(f.get()).toEqual([]);
  });
});
