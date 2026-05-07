import { mcpTilesParam } from '../schemas';

describe('mcpTilesParam: heatmap tiles', () => {
  it('parses a builder heatmap tile and preserves heatmap-specific fields', () => {
    const input = [
      {
        name: 'Latency Distribution',
        config: {
          displayType: 'heatmap',
          sourceId: 'source-id-123',
          where: 'SpanKind:SPAN_KIND_SERVER',
          whereLanguage: 'lucene',
          select: [
            {
              aggFn: 'heatmap',
              valueExpression: 'Duration',
              countExpression: 'count()',
              alias: 'Latency',
              heatmapScaleType: 'log',
            },
          ],
          numberFormat: { output: 'time', factor: 0.000000001 },
        },
      },
    ];

    const parsed = mcpTilesParam.parse(input);
    expect(parsed).toHaveLength(1);
    const tile = parsed[0];
    expect(tile.config.displayType).toBe('heatmap');
    if (tile.config.displayType !== 'heatmap') {
      throw new Error('expected heatmap tile');
    }
    expect(tile.config.sourceId).toBe('source-id-123');
    expect(tile.config.where).toBe('SpanKind:SPAN_KIND_SERVER');
    expect(tile.config.whereLanguage).toBe('lucene');
    expect(tile.config.select).toHaveLength(1);
    expect(tile.config.select[0]).toMatchObject({
      aggFn: 'heatmap',
      valueExpression: 'Duration',
      countExpression: 'count()',
      alias: 'Latency',
      heatmapScaleType: 'log',
    });
    expect(tile.config.numberFormat).toMatchObject({
      output: 'time',
      factor: 0.000000001,
    });
  });

  it('accepts a heatmap tile with whereLanguage="sql"', () => {
    const input = [
      {
        name: 'SQL-filtered Heatmap',
        config: {
          displayType: 'heatmap',
          sourceId: 'source-id-123',
          where: "SpanName = 'GET /healthz'",
          whereLanguage: 'sql',
          select: [{ aggFn: 'heatmap', valueExpression: 'Duration' }],
        },
      },
    ];

    const parsed = mcpTilesParam.parse(input);
    if (parsed[0].config.displayType !== 'heatmap') {
      throw new Error('expected heatmap tile');
    }
    expect(parsed[0].config.where).toBe("SpanName = 'GET /healthz'");
    expect(parsed[0].config.whereLanguage).toBe('sql');
  });

  it('rejects a heatmap tile with an invalid whereLanguage', () => {
    const input = [
      {
        name: 'Bad whereLanguage',
        config: {
          displayType: 'heatmap',
          sourceId: 'source-id-123',
          whereLanguage: 'regex',
          select: [{ aggFn: 'heatmap', valueExpression: 'Duration' }],
        },
      },
    ];

    expect(() => mcpTilesParam.parse(input)).toThrow();
  });

  it('parses a minimal heatmap tile with only required fields', () => {
    const input = [
      {
        name: 'Minimal Heatmap',
        config: {
          displayType: 'heatmap',
          sourceId: 'source-id-123',
          select: [{ aggFn: 'heatmap', valueExpression: 'Duration' }],
        },
      },
    ];

    const parsed = mcpTilesParam.parse(input);
    expect(parsed).toHaveLength(1);
    const tile = parsed[0];
    if (tile.config.displayType !== 'heatmap') {
      throw new Error('expected heatmap tile');
    }
    expect(tile.config.select[0].aggFn).toBe('heatmap');
    expect(tile.config.select[0].valueExpression).toBe('Duration');
    expect(tile.config.select[0].heatmapScaleType).toBeUndefined();
    expect(tile.config.select[0].countExpression).toBeUndefined();
    // where/whereLanguage default to empty + lucene when omitted, mirroring
    // the external API surface in packages/api/src/utils/zod.ts.
    expect(tile.config.where).toBe('');
    expect(tile.config.whereLanguage).toBe('lucene');
  });

  it('rejects a heatmap tile missing valueExpression', () => {
    const input = [
      {
        name: 'Bad Heatmap',
        config: {
          displayType: 'heatmap',
          sourceId: 'source-id-123',
          select: [{ aggFn: 'heatmap' }],
        },
      },
    ];

    expect(() => mcpTilesParam.parse(input)).toThrow();
  });

  it('rejects a heatmap tile with an invalid heatmapScaleType', () => {
    const input = [
      {
        name: 'Bad Scale',
        config: {
          displayType: 'heatmap',
          sourceId: 'source-id-123',
          select: [
            {
              aggFn: 'heatmap',
              valueExpression: 'Duration',
              heatmapScaleType: 'cubic',
            },
          ],
        },
      },
    ];

    expect(() => mcpTilesParam.parse(input)).toThrow();
  });

  it('rejects a heatmap tile with more than one select item', () => {
    const input = [
      {
        name: 'Too Many Series',
        config: {
          displayType: 'heatmap',
          sourceId: 'source-id-123',
          select: [
            { aggFn: 'heatmap', valueExpression: 'Duration' },
            { aggFn: 'heatmap', valueExpression: 'BodySize' },
          ],
        },
      },
    ];

    expect(() => mcpTilesParam.parse(input)).toThrow();
  });
});
