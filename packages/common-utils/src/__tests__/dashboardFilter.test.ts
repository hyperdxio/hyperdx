import { DashboardFilterSchema } from '@/types';

describe('DashboardFilterSchema', () => {
  // Minimum valid filter; reused across tests.
  const baseFilter = {
    id: 'filter-1',
    type: 'QUERY_EXPRESSION' as const,
    name: 'Environment',
    expression: 'environment',
    source: 'logs',
    whereLanguage: 'sql' as const,
  };

  it('accepts a minimal filter without constant or renderMode', () => {
    const parsed = DashboardFilterSchema.parse(baseFilter);
    expect(parsed.constant).toBeUndefined();
    expect(parsed.renderMode).toBeUndefined();
  });

  it('accepts constant: true and renderMode: readonly', () => {
    const parsed = DashboardFilterSchema.parse({
      ...baseFilter,
      constant: true,
      renderMode: 'readonly',
    });
    expect(parsed.constant).toBe(true);
    expect(parsed.renderMode).toBe('readonly');
  });

  it('accepts constant: true and renderMode: hidden', () => {
    const parsed = DashboardFilterSchema.parse({
      ...baseFilter,
      constant: true,
      renderMode: 'hidden',
    });
    expect(parsed.renderMode).toBe('hidden');
  });

  it('accepts all renderMode enum values', () => {
    for (const mode of ['editable', 'readonly', 'hidden'] as const) {
      const parsed = DashboardFilterSchema.parse({
        ...baseFilter,
        renderMode: mode,
      });
      expect(parsed.renderMode).toBe(mode);
    }
  });

  it('admits the orthogonal combination constant: true + renderMode: editable', () => {
    // The UI does not surface this combination, but the schema admits it
    // so MCP and external API callers can express future variants.
    const parsed = DashboardFilterSchema.parse({
      ...baseFilter,
      constant: true,
      renderMode: 'editable',
    });
    expect(parsed.constant).toBe(true);
    expect(parsed.renderMode).toBe('editable');
  });

  it('rejects an unknown renderMode value', () => {
    expect(() =>
      DashboardFilterSchema.parse({
        ...baseFilter,
        renderMode: 'invisible',
      }),
    ).toThrow();
  });

  it('rejects renderMode: null (must be omitted or one of the enum values)', () => {
    expect(() =>
      DashboardFilterSchema.parse({
        ...baseFilter,
        renderMode: null,
      }),
    ).toThrow();
  });

  it('rejects constant: null (must be omitted or boolean)', () => {
    expect(() =>
      DashboardFilterSchema.parse({
        ...baseFilter,
        constant: null,
      }),
    ).toThrow();
  });

  it('rejects constant: "true" as a string (boolean is strict)', () => {
    expect(() =>
      DashboardFilterSchema.parse({
        ...baseFilter,
        constant: 'true',
      }),
    ).toThrow();
  });
});
