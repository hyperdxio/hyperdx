import {
  displayTypeRequiresSource,
  isBuilderSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@/guards';
import { DisplayType } from '@/types';

describe('isRawSqlSavedChartConfig', () => {
  it('returns true when configType is "sql"', () => {
    expect(
      isRawSqlSavedChartConfig({
        configType: 'sql',
        displayType: DisplayType.Table,
        connection: 'conn-id',
        sqlTemplate: 'SELECT 1',
      } as any),
    ).toBe(true);
  });

  it('returns false for a builder config with no configType', () => {
    expect(
      isRawSqlSavedChartConfig({
        displayType: DisplayType.Line,
        source: 'src-id',
        select: [],
        where: '',
      } as any),
    ).toBe(false);
  });

  it('returns false for a markdown config', () => {
    expect(
      isRawSqlSavedChartConfig({
        displayType: DisplayType.Markdown,
        markdown: '# Hello',
        source: '',
        where: '',
        select: [],
      } as any),
    ).toBe(false);
  });
});

describe('isBuilderSavedChartConfig', () => {
  it('returns true for a standard builder config', () => {
    expect(
      isBuilderSavedChartConfig({
        displayType: DisplayType.Line,
        source: 'src-id',
        select: [],
        where: '',
      } as any),
    ).toBe(true);
  });

  it('returns false for a raw SQL config', () => {
    expect(
      isBuilderSavedChartConfig({
        configType: 'sql',
        displayType: DisplayType.Table,
        connection: 'conn-id',
        sqlTemplate: 'SELECT 1',
      } as any),
    ).toBe(false);
  });

  it('returns true for a markdown tile config', () => {
    // Markdown tiles are stored as BuilderSavedChartConfig with source: ''
    // because the type requires a source field. displayTypeRequiresSource()
    // is the canonical guard for excluding sourceless display types from the
    // "source unset" check -- see DBDashboardPage isSourceUnset.
    expect(
      isBuilderSavedChartConfig({
        displayType: DisplayType.Markdown,
        markdown: '# Hello',
        source: '',
        where: '',
        select: [],
      } as any),
    ).toBe(true);
  });
});

describe('displayTypeRequiresSource', () => {
  it('returns false for Markdown', () => {
    expect(displayTypeRequiresSource(DisplayType.Markdown)).toBe(false);
  });

  it('returns true for Line', () => {
    expect(displayTypeRequiresSource(DisplayType.Line)).toBe(true);
  });

  it('returns true for Table', () => {
    expect(displayTypeRequiresSource(DisplayType.Table)).toBe(true);
  });

  it('returns true for Search', () => {
    expect(displayTypeRequiresSource(DisplayType.Search)).toBe(true);
  });

  it('returns true for StackedBar', () => {
    expect(displayTypeRequiresSource(DisplayType.StackedBar)).toBe(true);
  });

  it('returns true for Pie', () => {
    expect(displayTypeRequiresSource(DisplayType.Pie)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(displayTypeRequiresSource(undefined)).toBe(true);
  });

  describe('isSourceUnset pattern', () => {
    // These tests exercise the production isSourceUnset condition used in
    // DBDashboardPage via the real displayTypeRequiresSource export.
    function isSourceUnset(config: any): boolean {
      return (
        !!config &&
        isBuilderSavedChartConfig(config) &&
        displayTypeRequiresSource(config.displayType) &&
        !config.source
      );
    }

    it('does not fire for markdown tiles with empty source', () => {
      expect(
        isSourceUnset({
          displayType: DisplayType.Markdown,
          markdown: '# Hello',
          source: '', // stored as '' by convertToInternalTileConfig
          where: '',
          select: [],
        }),
      ).toBe(false);
    });

    it('fires for builder tiles with empty source', () => {
      expect(
        isSourceUnset({
          displayType: DisplayType.Line,
          source: '',
          select: [],
          where: '',
        }),
      ).toBe(true);
    });

    it('does not fire for builder tiles with a real source', () => {
      expect(
        isSourceUnset({
          displayType: DisplayType.Line,
          source: 'abc123',
          select: [],
          where: '',
        }),
      ).toBe(false);
    });

    it('does not fire for raw SQL tiles', () => {
      expect(
        isSourceUnset({
          configType: 'sql',
          displayType: DisplayType.Table,
          connection: 'conn-id',
          sqlTemplate: 'SELECT 1',
        }),
      ).toBe(false);
    });
  });
});
