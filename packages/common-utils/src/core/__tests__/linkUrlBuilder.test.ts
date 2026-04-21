import type { OnClickSearch } from '../../types';
import { renderOnClickSearch } from '../linkUrlBuilder';

const dateRange: [Date, Date] = [
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-01T01:00:00Z'),
];

describe('renderSearchLinkPieces', () => {
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
