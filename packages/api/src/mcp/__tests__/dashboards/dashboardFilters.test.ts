import { callTool, getFirstText } from '../mcpTestUtils';
import { setupDashboardTests } from './setup';

// Filter modes (HDX-4404) via the MCP save/get path. The MCP input schema
// delegates to the same create/update body schemas the v2 REST path uses,
// so these guard that the MCP tool lights up the filter round-trip and the
// constant/renderMode coherence rejections at the input boundary.
describe('MCP Dashboard Tools - dashboard filters (HDX-4404)', () => {
  const ctx = setupDashboardTests();

  const traceTile = (sourceId: string) => ({
    name: 'Volume',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    config: {
      displayType: 'line' as const,
      sourceId,
      select: [{ aggFn: 'count' as const, where: '' }],
    },
  });

  it('should round-trip filters on create, get, and update', async () => {
    const sourceId = ctx.traceSource._id.toString();

    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Service Detail (MCP filter round-trip)',
        tiles: [traceTile(sourceId)],
        filters: [
          {
            type: 'QUERY_EXPRESSION',
            name: 'Service',
            expression: 'ServiceName',
            sourceId,
          },
          {
            type: 'QUERY_EXPRESSION',
            name: 'Environment',
            expression: 'deployment.environment',
            sourceId,
            where: "deployment.environment = 'production'",
            whereLanguage: 'sql',
          },
        ],
      },
    );

    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(getFirstText(createResult));
    expect(Array.isArray(created.filters)).toBe(true);
    expect(created.filters).toHaveLength(2);
    const [serviceFilter, envFilter] = created.filters;
    expect(serviceFilter).toMatchObject({
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'ServiceName',
      sourceId,
    });
    expect(typeof serviceFilter.id).toBe('string');
    expect(serviceFilter.id.length).toBeGreaterThan(0);
    expect(envFilter).toMatchObject({
      type: 'QUERY_EXPRESSION',
      name: 'Environment',
      expression: 'deployment.environment',
      sourceId,
      where: "deployment.environment = 'production'",
      whereLanguage: 'sql',
    });

    const getResult = await callTool(ctx.client!, 'clickstack_get_dashboard', {
      id: created.id,
    });
    const fetched = JSON.parse(getFirstText(getResult));
    expect(fetched.filters).toEqual(created.filters);

    const updateResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        id: created.id,
        name: 'Service Detail (MCP filter round-trip)',
        tiles: [traceTile(sourceId)],
        filters: [
          {
            id: serviceFilter.id,
            type: 'QUERY_EXPRESSION',
            name: 'Service (renamed)',
            expression: 'ServiceName',
            sourceId,
          },
        ],
      },
    );

    expect(updateResult.isError).toBeFalsy();
    const updated = JSON.parse(getFirstText(updateResult));
    expect(updated.filters).toHaveLength(1);
    expect(updated.filters[0]).toMatchObject({
      id: serviceFilter.id,
      type: 'QUERY_EXPRESSION',
      name: 'Service (renamed)',
      expression: 'ServiceName',
      sourceId,
    });
  });

  it('should round-trip constant and renderMode on filters (HDX-4404)', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const savedFilterValues = [
      {
        type: 'sql' as const,
        condition: "ServiceName IN ('hdx-private-api')",
      },
    ];
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Locked dashboard template',
        tiles: [traceTile(sourceId)],
        filters: [
          {
            type: 'QUERY_EXPRESSION',
            name: 'Service (locked)',
            expression: 'ServiceName',
            sourceId,
            whereLanguage: 'sql',
            constant: true,
            renderMode: 'readonly',
          },
        ],
        savedFilterValues,
      },
    );
    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(getFirstText(createResult));
    expect(created.savedFilterValues).toEqual(savedFilterValues);

    // GET preserves savedFilterValues verbatim alongside the filter.
    const getResult = await callTool(ctx.client!, 'clickstack_get_dashboard', {
      id: created.id,
    });
    const fetched = JSON.parse(getFirstText(getResult));
    expect(fetched.savedFilterValues).toEqual(savedFilterValues);
    expect(fetched.filters).toEqual(created.filters);

    // UPDATE with a different saved value: the new value replaces the
    // old one verbatim (clone-and-flip semantics).
    const nextSavedFilterValues = [
      {
        type: 'sql' as const,
        condition: "ServiceName IN ('hdx-public-api')",
      },
    ];
    const updateResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        id: created.id,
        name: 'Locked dashboard template',
        tiles: [traceTile(sourceId)],
        filters: [
          {
            id: created.filters[0].id,
            type: 'QUERY_EXPRESSION',
            name: 'Service (locked)',
            expression: 'ServiceName',
            sourceId,
            whereLanguage: 'sql',
            constant: true,
            renderMode: 'readonly',
          },
        ],
        savedFilterValues: nextSavedFilterValues,
      },
    );
    expect(updateResult.isError).toBeFalsy();
    const updated = JSON.parse(getFirstText(updateResult));
    expect(updated.savedFilterValues).toEqual(nextSavedFilterValues);
  });

  it('should reject mismatched sibling constants on the same expression (HDX-4404)', async () => {
    // Two filters on the same expression where one is constant and the
    // other editable: the editable side's URL value would clobber the
    // constant's locked value. The sibling refinement rejects this.
    const sourceId = ctx.traceSource._id.toString();
    const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
      name: 'Mismatched siblings',
      tiles: [traceTile(sourceId)],
      filters: [
        {
          type: 'QUERY_EXPRESSION',
          name: 'Service (locked)',
          expression: 'ServiceName',
          sourceId,
          whereLanguage: 'sql',
          constant: true,
          renderMode: 'readonly',
        },
        {
          type: 'QUERY_EXPRESSION',
          name: 'Service (editable)',
          expression: 'ServiceName',
          sourceId,
          whereLanguage: 'sql',
        },
      ],
    });
    expect(result.isError).toBeTruthy();
  });

  it('should reject renderMode without constant: true on the MCP schema (HDX-4404)', async () => {
    // renderMode 'readonly' without constant: true paints a locked-looking
    // chip the hook never overlays, so the WHERE clause never gains the
    // value. Rejected at the input boundary.
    const sourceId = ctx.traceSource._id.toString();
    const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
      name: 'Incoherent renderMode',
      tiles: [traceTile(sourceId)],
      filters: [
        {
          type: 'QUERY_EXPRESSION',
          name: 'Service',
          expression: 'ServiceName',
          sourceId,
          whereLanguage: 'sql',
          renderMode: 'readonly',
        },
      ],
    });
    expect(result.isError).toBeTruthy();
  });

  it('should reject constant: true with no matching savedFilterValues entry (HDX-4404)', async () => {
    // A constant filter is useful only when there is a value to lock to.
    // Without a matching savedFilterValues entry the chip renders locked
    // but the WHERE clause never applies, so reject at the boundary.
    const sourceId = ctx.traceSource._id.toString();
    const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
      name: 'Locked-but-no-saved-value',
      tiles: [traceTile(sourceId)],
      filters: [
        {
          type: 'QUERY_EXPRESSION',
          name: 'Service (locked)',
          expression: 'ServiceName',
          sourceId,
          whereLanguage: 'sql',
          constant: true,
          renderMode: 'readonly',
        },
      ],
      // No savedFilterValues to back the constant filter.
    });
    expect(result.isError).toBeTruthy();
  });
});
