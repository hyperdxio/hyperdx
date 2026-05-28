import {
  displayTypeRequiresSource,
  isBuilderSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@/guards';
import {
  ChartPaletteTokenSchema,
  DisplayType,
  isChartPaletteToken,
} from '@/types';

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

describe('isChartPaletteToken', () => {
  it('returns true for every hue-named categorical token', () => {
    const hues = [
      'chart-blue',
      'chart-orange',
      'chart-red',
      'chart-cyan',
      'chart-green',
      'chart-pink',
      'chart-purple',
      'chart-light-blue',
      'chart-brown',
      'chart-gray',
    ];
    for (const token of hues) {
      expect(isChartPaletteToken(token)).toBe(true);
    }
  });

  it('returns true for semantic tokens', () => {
    expect(isChartPaletteToken('chart-success')).toBe(true);
    expect(isChartPaletteToken('chart-warning')).toBe(true);
    expect(isChartPaletteToken('chart-error')).toBe(true);
  });

  it('returns false for legacy numeric tokens (handled by Zod preprocess, not the guard)', () => {
    // The guard checks the current ChartPaletteToken enum strictly; the
    // ChartPaletteTokenSchema preprocess is responsible for migrating
    // legacy chart-1..10 values from stored configs.
    expect(isChartPaletteToken('chart-1')).toBe(false);
    expect(isChartPaletteToken('chart-10')).toBe(false);
  });

  it('returns false for a raw hex string', () => {
    expect(isChartPaletteToken('#00c28a')).toBe(false);
    expect(isChartPaletteToken('#ff725c')).toBe(false);
  });

  it('returns false for undefined and null', () => {
    expect(isChartPaletteToken(undefined)).toBe(false);
    expect(isChartPaletteToken(null)).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(isChartPaletteToken(1)).toBe(false);
    expect(isChartPaletteToken(0)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isChartPaletteToken('')).toBe(false);
  });

  it('is case-sensitive (no uppercase matches)', () => {
    expect(isChartPaletteToken('Chart-Blue')).toBe(false);
    expect(isChartPaletteToken('CHART-SUCCESS')).toBe(false);
    expect(isChartPaletteToken('chart-Success')).toBe(false);
  });

  it('returns false for an out-of-range categorical hue', () => {
    expect(isChartPaletteToken('chart-magenta')).toBe(false);
    expect(isChartPaletteToken('chart-teal')).toBe(false);
  });

  it('returns false for strings that look similar but are not tokens', () => {
    expect(isChartPaletteToken('chart-')).toBe(false);
    expect(isChartPaletteToken('chart')).toBe(false);
    expect(isChartPaletteToken('chart-neutral')).toBe(false);
  });
});

describe('ChartPaletteTokenSchema legacy migration', () => {
  it('migrates each chart-1..10 to its HyperDX-slot-order hue equivalent', () => {
    const expected = [
      'chart-green', // 1 (HyperDX brand green)
      'chart-blue', // 2
      'chart-orange', // 3
      'chart-red', // 4
      'chart-cyan', // 5
      'chart-pink', // 6
      'chart-purple', // 7
      'chart-light-blue', // 8
      'chart-brown', // 9
      'chart-gray', // 10
    ];
    expected.forEach((target, i) => {
      expect(ChartPaletteTokenSchema.parse(`chart-${i + 1}`)).toBe(target);
    });
  });

  it('passes through valid hue tokens unchanged', () => {
    expect(ChartPaletteTokenSchema.parse('chart-blue')).toBe('chart-blue');
    expect(ChartPaletteTokenSchema.parse('chart-success')).toBe(
      'chart-success',
    );
  });

  it('rejects unknown strings even after preprocess', () => {
    expect(() => ChartPaletteTokenSchema.parse('chart-magenta')).toThrow();
    expect(() => ChartPaletteTokenSchema.parse('chart-11')).toThrow();
    expect(() => ChartPaletteTokenSchema.parse('#ff0000')).toThrow();
  });
});
