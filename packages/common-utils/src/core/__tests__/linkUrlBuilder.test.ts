import type { TableOnClickDashboard, TableOnClickSearch } from '../../types';
import {
  buildDashboardLinkUrl,
  buildSearchLinkUrlFromPieces,
  renderSearchLinkPieces,
} from '../linkUrlBuilder';

const dateRange: [Date, Date] = [
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-01T01:00:00Z'),
];

function lookup(entries: [string, string][] = []) {
  const nameToIds = new Map<string, string[]>();
  for (const [name, id] of entries) {
    const key = name.toLowerCase();
    const list = nameToIds.get(key) ?? [];
    list.push(id);
    nameToIds.set(key, list);
  }
  return { nameToIds };
}

describe('buildDashboardLinkUrl', () => {
  it('uses a concrete id target', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: {},
      dateRange,
      dashboards: lookup(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toContain('/dashboards/dash_1');
      expect(result.url).toContain('from=1767225600000');
      expect(result.url).toContain('to=1767229200000');
    }
  });

  it('resolves a name template against the lookup', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: {
        mode: 'template',
        template: '{{ServiceName}} Errors',
      },
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: { ServiceName: 'api' },
      dateRange,
      dashboards: lookup([['api Errors', 'dash_abc']]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toContain('/dashboards/dash_abc');
  });

  it('resolves case-insensitively', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: 'API ERRORS' },
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: {},
      dateRange,
      dashboards: lookup([['api errors', 'dash_abc']]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toContain('/dashboards/dash_abc');
  });

  it('errors when no dashboard matches the rendered name', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: {
        mode: 'template',
        template: '{{ServiceName}} Errors',
      },
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: { ServiceName: 'api' },
      dateRange,
      dashboards: lookup(),
    });
    expect(result).toEqual({
      ok: false,
      error: "Dashboard link: no dashboard named 'api Errors' was found",
    });
  });

  it('errors when the rendered name matches more than one dashboard', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: 'Errors' },
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: {},
      dateRange,
      dashboards: lookup([
        ['Errors', 'dash_1'],
        ['errors', 'dash_2'],
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/matches 2 dashboards/);
      expect(result.error).toMatch(/names must be unique/);
    }
  });

  it('errors when the name template renders empty', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      // In strict mode, referencing a missing key throws — so a template that
      // legitimately resolves to empty needs the key to exist with a falsy
      // value and a helper default.
      target: { mode: 'template', template: '{{default v ""}}' },
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: { v: null },
      dateRange,
      dashboards: lookup(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rendered empty/);
  });

  it('errors when a template references a column the row does not have', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: {
        mode: 'template',
        template: '{{ServiceName}} Errors',
      },
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: {},
      dateRange,
      dashboards: lookup(),
    });
    expect(result).toEqual({
      ok: false,
      error: "Dashboard link: row has no column 'ServiceName'",
    });
  });

  it('renders whereTemplate into the url', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'd1' },
      whereTemplate: "ServiceName = '{{ServiceName}}'",
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: { ServiceName: 'api' },
      dateRange,
      dashboards: lookup(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(`https://x${result.url}`);
      expect(url.searchParams.get('where')).toBe("ServiceName = 'api'");
      expect(url.searchParams.get('whereLanguage')).toBe('sql');
    }
  });

  it('renders filterValueTemplates into SQL IN conditions using the raw expression', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'd1' },
      filterValueTemplates: [
        { filter: 'ServiceName', template: '{{ServiceName}}' },
        { filter: 'Env', template: 'prod' },
      ],
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: { ServiceName: 'api' },
      dateRange,
      dashboards: lookup(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(`https://x${result.url}`);
      const f = JSON.parse(url.searchParams.get('filters') ?? '[]');
      expect(f).toEqual([
        { type: 'sql', condition: "ServiceName IN ('api')" },
        { type: 'sql', condition: "Env IN ('prod')" },
      ]);
    }
  });

  it('skips filterValueTemplates rows with empty filter or template', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'd1' },
      filterValueTemplates: [
        { filter: '', template: '{{ServiceName}}' },
        { filter: 'Env', template: '' },
        { filter: 'ServiceName', template: '{{ServiceName}}' },
      ],
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: { ServiceName: 'api' },
      dateRange,
      dashboards: lookup(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(`https://x${result.url}`);
      const f = JSON.parse(url.searchParams.get('filters') ?? '[]');
      expect(f).toEqual([{ type: 'sql', condition: "ServiceName IN ('api')" }]);
    }
  });

  it('merges repeated filter expressions into a single IN clause', () => {
    const onClick: TableOnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'd1' },
      filterValueTemplates: [
        { filter: 'ServiceName', template: 'api' },
        { filter: 'Env', template: 'prod' },
        { filter: 'ServiceName', template: 'web' },
      ],
      whereLanguage: 'sql',
    };
    const result = buildDashboardLinkUrl({
      onClick,
      row: {},
      dateRange,
      dashboards: lookup(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(`https://x${result.url}`);
      const f = JSON.parse(url.searchParams.get('filters') ?? '[]');
      // Expressions appear in order of first occurrence.
      expect(f).toEqual([
        { type: 'sql', condition: "ServiceName IN ('api', 'web')" },
        { type: 'sql', condition: "Env IN ('prod')" },
      ]);
    }
  });
});

describe('renderSearchLinkPieces', () => {
  const sourcesById = new Map<string, { id: string; name: string }>([
    ['src_1', { id: 'src_1', name: 'Logs' }],
  ]);
  const sourcesByName = new Map<string, { id: string; name: string }>([
    ['logs', { id: 'src_1', name: 'Logs' }],
  ]);

  it('resolves source by id', () => {
    const onClick: TableOnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
    };
    const result = renderSearchLinkPieces({
      onClick,
      row: {},
      sourcesById,
      sourcesByName,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sourceId).toBe('src_1');
  });

  it('resolves source by templated name', () => {
    const onClick: TableOnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    const result = renderSearchLinkPieces({
      onClick,
      row: { Src: 'Logs' },
      sourcesById,
      sourcesByName,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceId).toBe('src_1');
      expect(result.value.sourceResolvedFrom).toBe('template-name');
    }
  });

  it('errors when source template does not match any source', () => {
    const onClick: TableOnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    const result = renderSearchLinkPieces({
      onClick,
      row: { Src: 'NoSuchSource' },
      sourcesById,
      sourcesByName,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not resolve source/);
  });

  it('renders filterValueTemplates into SQL IN conditions', () => {
    const onClick: TableOnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filterValueTemplates: [
        { filter: 'ServiceName', template: '{{ServiceName}}' },
        { filter: 'Env', template: 'prod' },
      ],
    };
    const result = renderSearchLinkPieces({
      onClick,
      row: { ServiceName: 'api' },
      sourcesById,
      sourcesByName,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filters).toEqual([
        { type: 'sql', condition: "ServiceName IN ('api')" },
        { type: 'sql', condition: "Env IN ('prod')" },
      ]);
    }
  });

  it('skips filterValueTemplates rows with empty filter or template', () => {
    const onClick: TableOnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filterValueTemplates: [
        { filter: '', template: '{{ServiceName}}' },
        { filter: 'Env', template: '' },
        { filter: 'ServiceName', template: '{{ServiceName}}' },
      ],
    };
    const result = renderSearchLinkPieces({
      onClick,
      row: { ServiceName: 'api' },
      sourcesById,
      sourcesByName,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filters).toEqual([
        { type: 'sql', condition: "ServiceName IN ('api')" },
      ]);
    }
  });

  it('merges repeated filter expressions into a single IN clause', () => {
    const onClick: TableOnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filterValueTemplates: [
        { filter: 'ServiceName', template: 'api' },
        { filter: 'Env', template: 'prod' },
        { filter: 'ServiceName', template: 'web' },
      ],
    };
    const result = renderSearchLinkPieces({
      onClick,
      row: {},
      sourcesById,
      sourcesByName,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filters).toEqual([
        { type: 'sql', condition: "ServiceName IN ('api', 'web')" },
        { type: 'sql', condition: "Env IN ('prod')" },
      ]);
    }
  });
});

describe('buildSearchLinkUrlFromPieces', () => {
  it('appends from/to and base params', () => {
    const url = buildSearchLinkUrlFromPieces({
      pieces: {
        sourceId: 'src_1',
        sourceResolvedFrom: 'id',
        where: 'x = 1',
        whereLanguage: 'sql',
        filters: [],
      },
      dateRange,
    });
    const parsed = new URL(`https://x${url}`);
    expect(parsed.pathname).toBe('/search');
    expect(parsed.searchParams.get('source')).toBe('src_1');
    expect(parsed.searchParams.get('where')).toBe('x = 1');
    expect(parsed.searchParams.get('from')).toBe('1767225600000');
    expect(parsed.searchParams.get('to')).toBe('1767229200000');
  });
});
