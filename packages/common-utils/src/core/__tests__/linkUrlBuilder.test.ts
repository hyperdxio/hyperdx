import type { OnClickDashboard, OnClickSearch } from '../../types';
import {
  renderOnClickDashboard,
  renderOnClickSearch,
  validateOnClickTemplate,
} from '../linkUrlBuilder';

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
      expect(result.url).toContain('where=ServiceName+%3D+MyService');
      expect(result.url).toContain('whereLanguage=sql');
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
      expect(result.url).toContain('where=ServiceName%3AMyService');
      expect(result.url).toContain('whereLanguage=lucene');
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
      expect(result.url).toContain('where=ServiceName+%3D+MyService');
      expect(result.url).toContain('whereLanguage=sql');
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
      expect(result.url).toContain('where=ServiceName%3AMyService');
      expect(result.url).toContain('whereLanguage=lucene');
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
});
