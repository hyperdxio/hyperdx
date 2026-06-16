import {
  displayTypeRequiresSource,
  isBuilderSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@/guards';
import {
  CATEGORICAL_PALETTE_TOKENS,
  ChartPaletteTokenSchema,
  DisplayType,
  isChartPaletteToken,
  resolveChartPaletteToken,
  walkRawDashboardTileColors,
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
    for (const token of CATEGORICAL_PALETTE_TOKENS) {
      expect(isChartPaletteToken(token)).toBe(true);
    }
  });

  it('returns true for semantic tokens', () => {
    expect(isChartPaletteToken('chart-success')).toBe(true);
    expect(isChartPaletteToken('chart-warning')).toBe(true);
    expect(isChartPaletteToken('chart-error')).toBe(true);
  });

  it('returns false for legacy numeric tokens (handled by resolveChartPaletteToken, not the guard)', () => {
    // The guard checks the current ChartPaletteToken enum strictly.
    // Migration of legacy `chart-1`..`chart-10` is owned by
    // `resolveChartPaletteToken` (render-time) and
    // `normalizeDashboardTileColors` (fetch-time, in the app package).
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

describe('ChartPaletteTokenSchema', () => {
  it('accepts current hue-named and semantic tokens', () => {
    expect(ChartPaletteTokenSchema.parse('chart-blue')).toBe('chart-blue');
    expect(ChartPaletteTokenSchema.parse('chart-light-blue')).toBe(
      'chart-light-blue',
    );
    expect(ChartPaletteTokenSchema.parse('chart-success')).toBe(
      'chart-success',
    );
  });

  it('rejects legacy chart-1..10 — migration is owned by the app-side normalizer, not the schema', () => {
    // Keeping the schema strict (no `z.preprocess`) keeps its `z.input`
    // type equal to its `z.output` type. Wrapping the enum in
    // `z.preprocess` would force the input to `unknown`, which
    // poisons `validateRequest`'s `req.body` inference all the way
    // up to `Dashboard.tiles[i].config.color`. Stored legacy values
    // are healed at fetch time by `normalizeDashboardTileColors` in
    // `packages/app/src/dashboard.ts`.
    expect(() => ChartPaletteTokenSchema.parse('chart-1')).toThrow();
    expect(() => ChartPaletteTokenSchema.parse('chart-10')).toThrow();
  });

  it('rejects unknown strings', () => {
    expect(() => ChartPaletteTokenSchema.parse('chart-magenta')).toThrow();
    expect(() => ChartPaletteTokenSchema.parse('chart-11')).toThrow();
    expect(() => ChartPaletteTokenSchema.parse('#ff0000')).toThrow();
  });
});

describe('resolveChartPaletteToken', () => {
  it('returns hue-named tokens unchanged', () => {
    expect(resolveChartPaletteToken('chart-blue')).toBe('chart-blue');
    expect(resolveChartPaletteToken('chart-green')).toBe('chart-green');
    expect(resolveChartPaletteToken('chart-light-blue')).toBe(
      'chart-light-blue',
    );
  });

  it('returns semantic tokens unchanged', () => {
    expect(resolveChartPaletteToken('chart-success')).toBe('chart-success');
    expect(resolveChartPaletteToken('chart-warning')).toBe('chart-warning');
    expect(resolveChartPaletteToken('chart-error')).toBe('chart-error');
  });

  it('migrates legacy chart-1..10 to their HyperDX-slot-order hue equivalents', () => {
    expect(resolveChartPaletteToken('chart-1')).toBe('chart-green');
    expect(resolveChartPaletteToken('chart-2')).toBe('chart-blue');
    expect(resolveChartPaletteToken('chart-3')).toBe('chart-orange');
    expect(resolveChartPaletteToken('chart-4')).toBe('chart-red');
    expect(resolveChartPaletteToken('chart-5')).toBe('chart-cyan');
    expect(resolveChartPaletteToken('chart-6')).toBe('chart-pink');
    expect(resolveChartPaletteToken('chart-7')).toBe('chart-purple');
    expect(resolveChartPaletteToken('chart-8')).toBe('chart-light-blue');
    expect(resolveChartPaletteToken('chart-9')).toBe('chart-brown');
    expect(resolveChartPaletteToken('chart-10')).toBe('chart-gray');
  });

  it('returns undefined for unknown strings, hex values, and non-strings', () => {
    expect(resolveChartPaletteToken('chart-magenta')).toBeUndefined();
    expect(resolveChartPaletteToken('chart-11')).toBeUndefined();
    expect(resolveChartPaletteToken('#ff0000')).toBeUndefined();
    expect(resolveChartPaletteToken('')).toBeUndefined();
    expect(resolveChartPaletteToken(undefined)).toBeUndefined();
    expect(resolveChartPaletteToken(null)).toBeUndefined();
    expect(resolveChartPaletteToken(1)).toBeUndefined();
  });
});

// `walkRawDashboardTileColors` is the single shared per-tile traversal
// behind four sites: the React app's fetch- and write-time normalizer,
// the JSON-import pre-validation pass, the API dashboards-route
// middleware, and the dashboard provisioner. The tests below pin its
// contract directly; the per-callsite suites exercise the policy
// composed over it (legacy → hue, unknown preserved, etc).
describe('walkRawDashboardTileColors', () => {
  const identity = (current: string) => current;

  it('rewrites string colors via onColor', () => {
    const input = { tiles: [{ config: { color: 'chart-1' } }] };
    const result = walkRawDashboardTileColors(input, () => 'chart-green') as {
      tiles: Array<{ config: { color: string } }>;
    };
    expect(result.tiles[0].config.color).toBe('chart-green');
  });

  it('strips the color field when onColor returns undefined', () => {
    const input = {
      tiles: [{ id: 't1', config: { color: 'bad', other: 'kept' } }],
    };
    const result = walkRawDashboardTileColors(input, () => undefined) as {
      tiles: Array<{ id: string; config: { color?: string; other?: string } }>;
    };
    expect(result.tiles[0].config).not.toHaveProperty('color');
    expect(result.tiles[0].config.other).toBe('kept');
    expect(result.tiles[0].id).toBe('t1');
  });

  it('preserves referential identity when the callback returns the same string', () => {
    const input = { tiles: [{ config: { color: 'chart-orange' } }] };
    expect(walkRawDashboardTileColors(input, identity)).toBe(input);
  });

  it('skips tiles whose config has a non-string color', () => {
    const input = { tiles: [{ config: { color: 42 } }] };
    expect(walkRawDashboardTileColors(input, () => 'chart-blue')).toBe(input);
  });

  it('returns the input unchanged when tiles is missing, non-array, null, or a primitive', () => {
    expect(walkRawDashboardTileColors({ name: 'D' }, identity)).toEqual({
      name: 'D',
    });
    expect(walkRawDashboardTileColors({ tiles: 'nope' }, identity)).toEqual({
      tiles: 'nope',
    });
    expect(walkRawDashboardTileColors(null, identity)).toBeNull();
    expect(walkRawDashboardTileColors('hello', identity)).toBe('hello');
    expect(walkRawDashboardTileColors(undefined, identity)).toBeUndefined();
  });

  it('handles tiles whose config is missing or non-object', () => {
    const input = {
      tiles: [{ id: 'a' }, { id: 'b', config: null }, { id: 'c', config: 7 }],
    };
    // No color fields to touch → identity output.
    expect(walkRawDashboardTileColors(input, () => 'x')).toBe(input);
  });
});
