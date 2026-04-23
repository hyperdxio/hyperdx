import type { OnClickSearch } from '../../types';
import { renderOnClickSearch, validateOnClickSearch } from '../linkUrlBuilder';

const dateRange: [Date, Date] = [
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-01T01:00:00Z'),
];

describe('renderOnClickSearch', () => {
  const sourceIdsByName = new Map<string, string>([['Logs', 'src_1']]);

  it('resolves source by templated name', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    const result = renderOnClickSearch({
      onClick,
      row: { Src: 'Logs' },
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
      sourceIdsByName,
      dateRange,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Row has no column 'MissingColumn'");
  });
});

describe('validateOnClickSearch', () => {
  it('accepts a valid target template with no where template', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickSearch(onClick)).not.toThrow();
  });

  it('accepts valid target and where templates', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereTemplate: 'ServiceName = {{ServiceName}}',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickSearch(onClick)).not.toThrow();
  });

  it('accepts templates that reference variables without any runtime context', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Unknown}}' },
      whereTemplate: '{{a}} and {{b.c}}',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickSearch(onClick)).not.toThrow();
  });

  it('accepts templates using registered helpers', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{default Src "Logs"}}' },
      whereTemplate: 'id = {{floor n}}',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickSearch(onClick)).not.toThrow();
  });

  it('throws when the target template has invalid syntax', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{#if' },
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickSearch(onClick)).toThrow();
  });

  it('throws when the where template has invalid syntax', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereTemplate: '{{unclosed',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickSearch(onClick)).toThrow();
  });

  it('skips where-template validation when whereTemplate is undefined', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereLanguage: 'sql',
    };
    expect(onClick.whereTemplate).toBeUndefined();
    expect(() => validateOnClickSearch(onClick)).not.toThrow();
  });

  it('skips where-template validation when whereTemplate is an empty string', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{Src}}' },
      whereTemplate: '',
      whereLanguage: 'sql',
    };
    expect(() => validateOnClickSearch(onClick)).not.toThrow();
  });
});
