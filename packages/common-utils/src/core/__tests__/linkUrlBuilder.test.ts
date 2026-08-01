import {
  describeOnClick,
  renderOnClickDashboard,
  renderOnClickExternal,
  renderOnClickSearch,
  validateOnClickTemplate,
} from '@/core/linkUrlBuilder';
import type { OnClickDashboard, OnClickExternal, OnClickSearch } from '@/types';

const dateRange: [Date, Date] = [
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-01T01:00:00Z'),
];

describe('renderOnClickSearch', () => {
  const sourceIds = new Set<string>(['src_1']);
  const sourceIdsByName = new Map<string, string[]>([['Logs', ['src_1']]]);

  it('resolves source by ID', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: {},
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(
        '/search?source=src_1&where=&whereLanguage=sql&isLive=false&from=1767225600000&to=1767229200000',
      );
    }
  });

  it('errors when source ID does not exist', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_missing' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: {},
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Could not find source with ID 'src_missing'");
  });

  it('resolves source by templated name', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Src: 'Logs' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(
        '/search?source=src_1&where=&whereLanguage=sql&isLive=false&from=1767225600000&to=1767229200000',
      );
    }
  });

  it('templates a SQL where condition', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereTemplate: 'ServiceName = {{ServiceName}}',
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Src: 'Logs', ServiceName: 'MyService' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(decodeURIComponent(params.get('where') ?? '')).toBe(
        'ServiceName = MyService',
      );
      expect(params.get('whereLanguage')).toBe('sql');
    }
  });

  it('templates a lucene where condition', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereTemplate: 'ServiceName:{{ServiceName}}',
      whereLanguage: 'lucene',
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Src: 'Logs', ServiceName: 'MyService' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(decodeURIComponent(params.get('where') ?? '')).toBe(
        'ServiceName:MyService',
      );
      expect(params.get('whereLanguage')).toBe('lucene');
    }
  });

  it('errors when source template does not match any source', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Src: 'NoSuchSource' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Could not find source 'NoSuchSource'");
  });

  it('errors when template references missing column', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{MissingColumn}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Src: 'Logs' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Row has no column 'MissingColumn'");
  });

  it('errors when resolved source name is empty', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Src: '   ' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Source name is empty');
  });

  it('errors when multiple sources share the resolved name', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Src: 'Duplicated' },
      sourceIds: new Set<string>(['src_a', 'src_b']),
      sourceIdsByName: new Map<string, string[]>([
        ['Duplicated', ['src_a', 'src_b']],
      ]),
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe(
        "Multiple sources named 'Duplicated' — source names must be unique to use them in a link",
      );
  });

  it('omits the filters param when no filter templates are provided', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filters: [],
    };
    const result = renderOnClickSearch({
      onClick,
      row: {},
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(params.has('filters')).toBe(false);
    }
  });

  it('renders a single filter template as an IN clause', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{ServiceName}}',
        },
      ],
    };
    const result = renderOnClickSearch({
      onClick,
      row: { ServiceName: 'MyService' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([{ type: 'sql', condition: "ServiceName IN ('MyService')" }]);
    }
  });

  it('merges filter templates sharing an expression into one IN clause', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{Service1}}',
        },
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{Service2}}',
        },
      ],
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Service1: 'A', Service2: 'B' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([{ type: 'sql', condition: "ServiceName IN ('A', 'B')" }]);
    }
  });

  it('emits separate filters for distinct expressions', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{Service}}',
        },
        {
          kind: 'expressionTemplate',
          expression: 'SeverityText',
          template: '{{Severity}}',
        },
      ],
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Service: 'MyService', Severity: 'error' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([
        { type: 'sql', condition: "ServiceName IN ('MyService')" },
        { type: 'sql', condition: "SeverityText IN ('error')" },
      ]);
    }
  });

  it('escapes single quotes in rendered filter values', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{ServiceName}}',
        },
      ],
    };
    const result = renderOnClickSearch({
      onClick,
      row: { ServiceName: "O'Malley" },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([{ type: 'sql', condition: "ServiceName IN ('O''Malley')" }]);
    }
  });

  it('escapes backslashes in rendered filter values', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'FilePath',
          template: '{{FilePath}}',
        },
      ],
    };
    const result = renderOnClickSearch({
      onClick,
      row: { FilePath: 'C:\\path\\to\\file' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([
        { type: 'sql', condition: "FilePath IN ('C:\\\\path\\\\to\\\\file')" },
      ]);
    }
  });

  it('URL-encodes rendered filter values', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: "SpanAttributes['url']",
          template: '{{url}}',
        },
      ],
    };
    const result = renderOnClickSearch({
      onClick,
      row: { url: '/users%2F42' },
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([
        {
          type: 'sql',
          condition: "SpanAttributes['url'] IN ('/users%2F42')",
        },
      ]);
    }
  });

  it('errors when a filter template references a missing column', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{MissingColumn}}',
        },
      ],
    };
    const result = renderOnClickSearch({
      onClick,
      row: {},
      sourceIds,
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Row has no column 'MissingColumn'");
  });
});

describe('renderOnClickDashboard', () => {
  const dashboardIds = new Set<string>(['dash_1']);
  const dashboardIdsByName = new Map<string, string[]>([
    ['Service Overview', ['dash_1']],
  ]);

  it('resolves dashboard by ID', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: {},
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(
        '/dashboards/dash_1?where=&whereLanguage=sql&from=1767225600000&to=1767229200000',
      );
    }
  });

  it('errors when dashboard ID does not exist', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_missing' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: {},
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe(
        "Could not find dashboard with ID 'dash_missing'",
      );
  });

  it('resolves dashboard by templated name', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: '{{Dashboard}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Dashboard: 'Service Overview' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(
        '/dashboards/dash_1?where=&whereLanguage=sql&from=1767225600000&to=1767229200000',
      );
    }
  });

  it('templates a SQL where condition', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: '{{Dashboard}}' },
      whereTemplate: 'ServiceName = {{ServiceName}}',
      whereLanguage: 'sql',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Dashboard: 'Service Overview', ServiceName: 'MyService' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(decodeURIComponent(params.get('where') ?? '')).toBe(
        'ServiceName = MyService',
      );
      expect(params.get('whereLanguage')).toBe('sql');
    }
  });

  it('templates a lucene where condition', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: '{{Dashboard}}' },
      whereTemplate: 'ServiceName:{{ServiceName}}',
      whereLanguage: 'lucene',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Dashboard: 'Service Overview', ServiceName: 'MyService' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(decodeURIComponent(params.get('where') ?? '')).toBe(
        'ServiceName:MyService',
      );
      expect(params.get('whereLanguage')).toBe('lucene');
    }
  });

  it('errors when dashboard template does not match any dashboard', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: '{{Dashboard}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Dashboard: 'NoSuchDashboard' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Could not find dashboard 'NoSuchDashboard'");
  });

  it('errors when template references missing column', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: '{{MissingColumn}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Dashboard: 'Service Overview' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Row has no column 'MissingColumn'");
  });

  it('errors when resolved dashboard name is empty', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: '{{Dashboard}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Dashboard: '   ' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Dashboard name is empty');
  });

  it('errors when multiple dashboards share the resolved name', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: '{{Dashboard}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Dashboard: 'Duplicated' },
      dashboardIds: new Set<string>(['dash_a', 'dash_b']),
      dashboardIdsByName: new Map<string, string[]>([
        ['Duplicated', ['dash_a', 'dash_b']],
      ]),
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe(
        "Multiple dashboards named 'Duplicated' — dashboard names must be unique to use them in a link",
      );
  });

  it('omits the filters param when no filter templates are provided', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
      filters: [],
    };
    const result = renderOnClickDashboard({
      onClick,
      row: {},
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(params.has('filters')).toBe(false);
    }
  });

  it('renders a single filter template as an IN clause', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{ServiceName}}',
        },
      ],
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { ServiceName: 'MyService' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([{ type: 'sql', condition: "ServiceName IN ('MyService')" }]);
    }
  });

  it('merges filter templates sharing an expression into one IN clause', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{Service1}}',
        },
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{Service2}}',
        },
      ],
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Service1: 'A', Service2: 'B' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([{ type: 'sql', condition: "ServiceName IN ('A', 'B')" }]);
    }
  });

  it('emits separate filters for distinct expressions', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{Service}}',
        },
        {
          kind: 'expressionTemplate',
          expression: 'SeverityText',
          template: '{{Severity}}',
        },
      ],
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { Service: 'MyService', Severity: 'error' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([
        { type: 'sql', condition: "ServiceName IN ('MyService')" },
        { type: 'sql', condition: "SeverityText IN ('error')" },
      ]);
    }
  });

  it('escapes single quotes in rendered filter values', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{ServiceName}}',
        },
      ],
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { ServiceName: "O'Malley" },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([{ type: 'sql', condition: "ServiceName IN ('O''Malley')" }]);
    }
  });

  it('escapes backslashes in rendered filter values', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'FilePath',
          template: '{{FilePath}}',
        },
      ],
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { FilePath: 'C:\\path\\to\\file' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([
        { type: 'sql', condition: "FilePath IN ('C:\\\\path\\\\to\\\\file')" },
      ]);
    }
  });

  it('URL-encodes rendered filter values', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: "SpanAttributes['url']",
          template: '{{url}}',
        },
      ],
    };
    const result = renderOnClickDashboard({
      onClick,
      row: { url: '/users%2F42' },
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const params = new URLSearchParams(result.url.split('?')[1]);
      expect(
        JSON.parse(decodeURIComponent(params.get('filters') ?? '')),
      ).toEqual([
        {
          type: 'sql',
          condition: "SpanAttributes['url'] IN ('/users%2F42')",
        },
      ]);
    }
  });

  it('errors when a filter template references a missing column', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
      filters: [
        {
          kind: 'expressionTemplate',
          expression: 'ServiceName',
          template: '{{MissingColumn}}',
        },
      ],
    };
    const result = renderOnClickDashboard({
      onClick,
      row: {},
      dashboardIds,
      dashboardIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Row has no column 'MissingColumn'");
  });
});

describe('renderOnClickExternal', () => {
  it('renders a static absolute https URL', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'https://grafana.example.com/d/abc',
    };
    const result = renderOnClickExternal({ onClick, row: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe('https://grafana.example.com/d/abc');
    }
  });

  it('renders a templated URL from row columns', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate:
        'https://grafana.example.com/d/abc?var-service={{ServiceName}}',
    };
    const result = renderOnClickExternal({
      onClick,
      row: { ServiceName: 'checkout' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(
        'https://grafana.example.com/d/abc?var-service=checkout',
      );
    }
  });

  it('allows http URLs', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'http://internal-tool.local/runbook',
    };
    const result = renderOnClickExternal({ onClick, row: {} });
    expect(result.ok).toBe(true);
  });

  it('trims surrounding whitespace from the rendered URL', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: '  https://example.com/{{Path}}  ',
    };
    const result = renderOnClickExternal({
      onClick,
      row: { Path: 'page' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe('https://example.com/page');
    }
  });

  it('errors when the template references a missing column', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'https://example.com/{{MissingColumn}}',
    };
    const result = renderOnClickExternal({ onClick, row: {} });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Row has no column 'MissingColumn'");
  });

  it('errors when the rendered URL is empty', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: '{{Blank}}',
    };
    const result = renderOnClickExternal({
      onClick,
      row: { Blank: '' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('External link URL is empty');
  });

  it('percent-encodes a column value so it cannot inject extra query params', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate:
        'https://grafana.example.com/d/abc?var-service={{ServiceName}}',
    };
    const result = renderOnClickExternal({
      onClick,
      row: { ServiceName: 'checkout&admin=true' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(
        'https://grafana.example.com/d/abc?var-service=checkout%26admin%3Dtrue',
      );
      // The injected "&admin=true" must NOT become a separate query param.
      const parsed = new URL(result.url);
      expect(parsed.searchParams.get('var-service')).toBe(
        'checkout&admin=true',
      );
      expect(parsed.searchParams.has('admin')).toBe(false);
    }
  });

  it('percent-encodes path-traversal and fragment characters in a column value', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'https://example.com/service/{{ServiceName}}',
    };
    const result = renderOnClickExternal({
      onClick,
      row: { ServiceName: '../../etc/passwd#frag' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(
        'https://example.com/service/..%2F..%2Fetc%2Fpasswd%23frag',
      );
      const parsed = new URL(result.url);
      expect(parsed.pathname).toBe('/service/..%2F..%2Fetc%2Fpasswd%23frag');
      expect(parsed.hash).toBe('');
    }
  });

  it('does not encode the template author\u2019s own URL structure', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'https://example.com/d/abc?a={{A}}&b={{B}}#section={{C}}',
    };
    const result = renderOnClickExternal({
      onClick,
      row: { A: 'x y', B: 'p/q', C: 'z' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe(
        'https://example.com/d/abc?a=x%20y&b=p%2Fq#section=z',
      );
      const parsed = new URL(result.url);
      expect(parsed.searchParams.get('a')).toBe('x y');
      expect(parsed.searchParams.get('b')).toBe('p/q');
      expect(parsed.hash).toBe('#section=z');
    }
  });

  it('rejects a javascript: scheme to prevent XSS', () => {
    const onClick: OnClickExternal = {
      type: 'external',

      urlTemplate: 'javascript:alert(1)',
    };
    const result = renderOnClickExternal({ onClick, row: {} });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain('must be an absolute http(s) URL');
  });

  it('rejects relative URLs', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: '/dashboards/123',
    };
    const result = renderOnClickExternal({ onClick, row: {} });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain('must be an absolute http(s) URL');
  });

  it('rejects non-http(s) schemes like data:', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'data:text/html,<script>alert(1)</script>',
    };
    const result = renderOnClickExternal({ onClick, row: {} });
    expect(result.ok).toBe(false);
  });
});

describe('validateOnClickTemplate', () => {
  it('accepts a valid target template with no where template', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickTemplate(onClick)).not.toThrow();
  });

  it('accepts valid target and where templates', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereTemplate: 'ServiceName = {{ServiceName}}',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickTemplate(onClick)).not.toThrow();
  });

  it('accepts templates that reference variables without any runtime context', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Unknown}}' },
      whereTemplate: '{{a}} and {{b.c}}',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickTemplate(onClick)).not.toThrow();
  });

  it('accepts templates using registered helpers', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{default Src "Logs"}}' },
      whereTemplate: 'id = {{floor n}}',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickTemplate(onClick)).not.toThrow();
  });

  it('throws when the target template has invalid syntax', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{#if' },
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickTemplate(onClick)).toThrow();
  });

  it('throws when the where template has invalid syntax', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereTemplate: '{{unclosed',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickTemplate(onClick)).toThrow();
  });

  it('skips where-template validation when whereTemplate is undefined', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    expect(onClick.whereTemplate).toBeUndefined();
    expect(() => validateOnClickTemplate(onClick)).not.toThrow();
  });

  it('skips where-template validation when whereTemplate is an empty string', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereTemplate: '',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickTemplate(onClick)).not.toThrow();
  });

  it('accepts a valid external url template', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'https://example.com/{{ServiceName}}',
    };
    expect(() => validateOnClickTemplate(onClick)).not.toThrow();
  });

  it('throws when the external url template has invalid syntax', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'https://example.com/{{#if',
    };
    expect(() => validateOnClickTemplate(onClick)).toThrow();
  });
});

describe('describeOnClick', () => {
  const sourceNamesById = new Map<string, string>([['src_1', 'HyperDX Logs']]);
  const dashboardNamesById = new Map<string, string>([
    ['dash_1', 'API Latency Drilldown'],
  ]);

  it('describes a search action targeting a known source by ID with the resolved name', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
    };
    expect(
      describeOnClick({ onClick, sourceNamesById, dashboardNamesById }),
    ).toBe('Search HyperDX Logs');
  });

  it('falls back to a generic verb form when the search source ID is not in the lookup', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_missing' },
      whereLanguage: 'sql',
    };
    expect(
      describeOnClick({ onClick, sourceNamesById, dashboardNamesById }),
    ).toBe('Open in search');
  });

  it('falls back to a generic verb form for template-mode search targets', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    expect(
      describeOnClick({ onClick, sourceNamesById, dashboardNamesById }),
    ).toBe('Open in search');
  });

  it('describes a dashboard action targeting a known dashboard by ID with the resolved name', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
    };
    expect(
      describeOnClick({ onClick, sourceNamesById, dashboardNamesById }),
    ).toBe('Open dashboard "API Latency Drilldown"');
  });

  it('falls back to a generic verb form when the dashboard ID is not in the lookup', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_missing' },
      whereLanguage: 'sql',
    };
    expect(
      describeOnClick({ onClick, sourceNamesById, dashboardNamesById }),
    ).toBe('Open dashboard');
  });

  it('falls back to a generic verb form for template-mode dashboard targets', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'template', template: '{{Dashboard}}' },
      whereLanguage: 'sql',
    };
    expect(
      describeOnClick({ onClick, sourceNamesById, dashboardNamesById }),
    ).toBe('Open dashboard');
  });

  it('describes an external link action', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: 'https://example.com/{{ServiceName}}',
    };
    expect(
      describeOnClick({ onClick, sourceNamesById, dashboardNamesById }),
    ).toBe('Open external link');
  });
});
