// The MCP dashboard authoring tile schemas (what save_dashboard / patch_dashboard
// accept) are a hand-maintained mirror of the external REST dashboard schemas,
// with no shared type or derivation. A field added to a REST table config but not
// to the matching MCP tile schema is silently stripped on MCP writes, which is the
// failure mode that let alternateRowBackground drop on raw SQL table tiles. These
// tests assert each MCP table config declares every field its REST counterpart
// accepts, so field-presence drift fails here instead of escaping review.
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
