import { Types } from 'mongoose';

import { mcpTilesParam } from '@/mcp/tools/dashboards/schemas';

/**
 * `enableExemplars` and `exemplarTraceSourceId` are the two exemplar settings an
 * MCP agent can put on a tile. The trace source id has to survive as something
 * the source lookup can actually resolve — it is read back as a Mongo ObjectId —
 * so accepting any string here would persist a tile whose markers silently never
 * link to a trace.
 */
const tile =
  (displayType: 'line' | 'stacked_bar') =>
  (config: Record<string, unknown>) => [
    {
      name: 'Latency',
      config: {
        displayType,
        sourceId: new Types.ObjectId().toString(),
        select: [{ aggFn: 'count', alias: 'Requests' }],
        ...config,
      },
    },
  ];

// The two tile types declare the exemplar fields in separate schema blocks, so
// an edit that only updates one would otherwise go unnoticed.
const lineTile = tile('line');
const barTile = tile('stacked_bar');

describe('MCP tile exemplar settings', () => {
  it('accepts a valid ObjectId as the exemplar trace source', () => {
    const traceSourceId = new Types.ObjectId().toString();
    const parsed = mcpTilesParam.parse(
      lineTile({ enableExemplars: true, exemplarTraceSourceId: traceSourceId }),
    );
    expect(parsed[0].config).toMatchObject({
      enableExemplars: true,
      exemplarTraceSourceId: traceSourceId,
    });
  });

  it.each([
    ['a source name rather than an id', 'Traces'],
    ['a truncated id', '507f1f77bcf86cd7994390'],
    ['an over-long id', '507f1f77bcf86cd799439011ff'],
    ['an empty string', ''],
    ['a non-hex id of the right length', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
  ])('rejects %s as the exemplar trace source', (_label, value) => {
    expect(() =>
      mcpTilesParam.parse(lineTile({ exemplarTraceSourceId: value })),
    ).toThrow(/Invalid ObjectId/);
  });

  // Worth recording because it is surprising: Mongo also accepts a 12-character
  // string as 12 raw bytes, so `Types.ObjectId.isValid` — and therefore every
  // objectIdSchema field in this codebase, not just this one — lets one through.
  // Such an id simply resolves to no source, which is the same outcome as any
  // other id that does not exist, so it is not worth diverging from the shared
  // validator here.
  it('lets a 12-character string through, as every other id field does', () => {
    expect(() =>
      mcpTilesParam.parse(lineTile({ exemplarTraceSourceId: 'trace-source' })),
    ).not.toThrow();
  });

  it('leaves both settings optional', () => {
    const parsed = mcpTilesParam.parse(lineTile({}));
    expect(parsed[0].config).not.toHaveProperty('enableExemplars');
    expect(parsed[0].config).not.toHaveProperty('exemplarTraceSourceId');
  });

  it.each([
    ['line', lineTile],
    ['stacked_bar', barTile],
  ])('validates the trace source on a %s tile', (_label, build) => {
    expect(() =>
      mcpTilesParam.parse(build({ exemplarTraceSourceId: 'Traces' })),
    ).toThrow(/Invalid ObjectId/);
    const id = new Types.ObjectId().toString();
    expect(
      mcpTilesParam.parse(build({ exemplarTraceSourceId: id }))[0].config,
    ).toMatchObject({ exemplarTraceSourceId: id });
  });
});
