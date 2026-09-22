// The MCP dashboard authoring tile schemas (what save_dashboard / patch_dashboard
// accept) are a hand-maintained mirror of the external REST dashboard schemas,
// with no shared type or derivation. A field added to a REST table config but not
// to the matching MCP tile schema is silently stripped on MCP writes, which is the
// failure mode that let alternateRowBackground drop on raw SQL table tiles. These
// tests assert each MCP table config declares every field its REST counterpart
// accepts, so field-presence drift fails here instead of escaping review.
//
// Two deliberate limits:
//
// 1. Table configs only. mcpSqlTileSchema is one schema serving all six raw SQL
//    display types, so the same check could run against the line, stacked_bar,
//    number, pie and bar variants. It does not yet, because seriesLimit is
//    already missing there and the assertion would fail on a pre-existing gap
//    unrelated to this file's subject. HDX-5446 fixes that and widens this test.
// 2. One direction: REST is the authority, so every REST field must exist on
//    MCP. The reverse is not asserted, because mcpTableTileSchema deliberately
//    declares where / whereLanguage as z.never() to reject tile-level filters on
//    builder tiles, and those fields exist precisely to be refused.
import {
  mcpSqlTileSchema,
  mcpTableTileSchema,
} from '@/mcp/tools/dashboards/schemas';
import {
  externalDashboardTableChartConfigSchema,
  externalDashboardTableRawSqlChartConfigSchema,
} from '@/utils/zod';

describe('MCP dashboard tile schema parity with the external REST schemas', () => {
  it('builder table: MCP config declares every field the REST builder table schema accepts', () => {
    const restFields = Object.keys(
      externalDashboardTableChartConfigSchema.shape,
    );
    const mcpFields = new Set(
      Object.keys(mcpTableTileSchema.shape.config.shape),
    );

    expect(restFields.filter(field => !mcpFields.has(field))).toEqual([]);
  });

  it('raw SQL table: MCP config declares every field the REST raw SQL table schema accepts', () => {
    const restFields = Object.keys(
      externalDashboardTableRawSqlChartConfigSchema.shape,
    );
    const mcpFields = new Set(Object.keys(mcpSqlTileSchema.shape.config.shape));

    expect(restFields.filter(field => !mcpFields.has(field))).toEqual([]);
  });
});
