import { z } from 'zod';

import {
  DashboardFilter,
  DashboardFilterSchema,
  refineDashboardFilterCoherence,
  refineDashboardFiltersConstantSiblings,
} from '@/types';

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

describe('refineDashboardFilterCoherence', () => {
  // Standalone schema that applies the per-filter refinement directly,
  // so each rejection branch can be exercised in isolation against the
  // refinement helper itself (`DashboardFilterSchema` does NOT carry
  // the refinement so its `.omit`/`.extend` chains keep working).
  const SchemaWithCoherence = DashboardFilterSchema.superRefine(
    refineDashboardFilterCoherence,
  );

  const baseFilter = {
    id: 'filter-1',
    type: 'QUERY_EXPRESSION' as const,
    name: 'Service',
    expression: 'ServiceName',
    source: 'traces',
    whereLanguage: 'sql' as const,
  };

  it('accepts a plain editable filter (no constant, no renderMode)', () => {
    expect(() => SchemaWithCoherence.parse(baseFilter)).not.toThrow();
  });

  it('accepts constant: true paired with renderMode: readonly', () => {
    expect(() =>
      SchemaWithCoherence.parse({
        ...baseFilter,
        constant: true,
        renderMode: 'readonly',
      }),
    ).not.toThrow();
  });

  it('accepts constant: true paired with renderMode: hidden', () => {
    expect(() =>
      SchemaWithCoherence.parse({
        ...baseFilter,
        constant: true,
        renderMode: 'hidden',
      }),
    ).not.toThrow();
  });

  it('accepts the orthogonal combination constant: true + renderMode: editable', () => {
    // The UI doesn't surface this, but the schema admits it for future
    // MCP / external API variants. The refinement only rejects the
    // INVERSE (locked-looking renderMode without constant: true).
    expect(() =>
      SchemaWithCoherence.parse({
        ...baseFilter,
        constant: true,
        renderMode: 'editable',
      }),
    ).not.toThrow();
  });

  it('rejects renderMode: readonly without constant: true', () => {
    const result = SchemaWithCoherence.safeParse({
      ...baseFilter,
      renderMode: 'readonly',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i =>
        (i.message ?? '').includes('renderMode'),
      );
      expect(issue?.path).toEqual(['renderMode']);
    }
  });

  it('rejects renderMode: hidden without constant: true', () => {
    const result = SchemaWithCoherence.safeParse({
      ...baseFilter,
      renderMode: 'hidden',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i =>
        (i.message ?? '').includes('renderMode'),
      );
      expect(issue?.path).toEqual(['renderMode']);
    }
  });
});

describe('refineDashboardFiltersConstantSiblings', () => {
  // The sibling rule rejects mixed constant + editable on the SAME
  // normalized expression, regardless of bracket-vs-dot notation. Apply
  // the refinement to an array schema so the test mirrors how it is
  // used on dashboard payloads.
  const ArraySchema = z
    .array(DashboardFilterSchema)
    .superRefine(refineDashboardFiltersConstantSiblings);

  const makeFilter = (
    expression: string,
    constant: boolean,
    suffix = '',
  ): DashboardFilter => ({
    id: `filter-${expression}-${suffix || (constant ? 'const' : 'editable')}`,
    type: 'QUERY_EXPRESSION',
    name: `Filter ${expression}`,
    expression,
    source: 'traces',
    whereLanguage: 'sql',
    ...(constant ? { constant: true } : {}),
  });

  it('accepts an empty filter array', () => {
    expect(() => ArraySchema.parse([])).not.toThrow();
  });

  it('accepts two filters with different expressions', () => {
    expect(() =>
      ArraySchema.parse([
        makeFilter('ServiceName', false),
        makeFilter('environment', true),
      ]),
    ).not.toThrow();
  });

  it('accepts two constant siblings on the same expression', () => {
    // Two locked filters on the same expression with different
    // `appliesToSourceIds` is a schema-legal pattern; they both lock
    // to the same saved value and the dashboard-level scope is the
    // disambiguator.
    expect(() =>
      ArraySchema.parse([
        makeFilter('ServiceName', true, 'a'),
        makeFilter('ServiceName', true, 'b'),
      ]),
    ).not.toThrow();
  });

  it('accepts two editable siblings on the same expression', () => {
    expect(() =>
      ArraySchema.parse([
        makeFilter('ServiceName', false, 'a'),
        makeFilter('ServiceName', false, 'b'),
      ]),
    ).not.toThrow();
  });

  it('rejects mixing constant: true + editable on the same expression', () => {
    const result = ArraySchema.safeParse([
      makeFilter('ServiceName', true),
      makeFilter('ServiceName', false),
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i =>
        (i.message ?? '').includes('same expression'),
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects mixed siblings even when one uses bracket notation', () => {
    // Bracket-vs-dot normalization: `SpanAttributes['service.name']` and
    // `SpanAttributes.service.name` resolve to the same key via
    // `parseKeyPath().join('.')`. Mixing constant + editable across the
    // two MUST still be rejected because the runtime overlay also
    // normalizes both forms to the same key.
    const result = ArraySchema.safeParse([
      makeFilter("SpanAttributes['service.name']", true),
      makeFilter('SpanAttributes.service.name', false),
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i =>
        (i.message ?? '').includes('same expression'),
      );
      expect(issue).toBeDefined();
    }
  });

  it('handles nested bracket-notation expressions via parseKeyPath', () => {
    // `parseKeyPath` strips a single bracket segment from the front, so
    // `SpanAttributes['k8s']` -> ['SpanAttributes', 'k8s']. A nested
    // sibling expressed in dot notation normalizes to the same path.
    // Two locked siblings on the nested expression must be accepted.
    expect(() =>
      ArraySchema.parse([
        makeFilter("SpanAttributes['k8s.pod']", true, 'a'),
        makeFilter('SpanAttributes.k8s.pod', true, 'b'),
      ]),
    ).not.toThrow();
  });
});
