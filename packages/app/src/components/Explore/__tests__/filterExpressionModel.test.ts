import type {
  FilterRange,
  FilterState,
} from '@hyperdx/common-utils/dist/filters';

import {
  type FilterClause,
  type FilterGroup,
  filterStateToExpression,
  formatClauseLabel,
  lastClause,
  removeFilterClause,
  shouldShowJoins,
} from '@/components/Explore/filterExpressionModel';

function state(
  entries: Record<
    string,
    {
      included?: Array<string | boolean>;
      excluded?: Array<string | boolean>;
      range?: FilterRange;
    }
  >,
): FilterState {
  const result: FilterState = {};
  for (const [field, sel] of Object.entries(entries)) {
    result[field] = {
      included: new Set(sel.included ?? []),
      excluded: new Set(sel.excluded ?? []),
      range: sel.range,
    };
  }
  return result;
}

describe('filterStateToExpression', () => {
  it('returns null for an empty filter state', () => {
    expect(filterStateToExpression(state({}))).toBeNull();
  });

  it('unwraps a single included value to a clause', () => {
    const expr = filterStateToExpression(
      state({ Level: { included: ['error'] } }),
    );
    expect(expr).toEqual({
      kind: 'clause',
      field: 'Level',
      value: 'error',
      type: 'included',
      rawValue: 'error',
    } satisfies FilterClause);
  });

  it('groups multiple values of the same field with OR', () => {
    const expr = filterStateToExpression(
      state({ Body: { included: ['*timeout*', '*crash*'] } }),
    );
    expect(expr?.kind).toBe('group');
    const group = expr as FilterGroup;
    expect(group.op).toBe('OR');
    expect(group.children).toHaveLength(2);
    expect(group.children.map(c => (c as FilterClause).value)).toEqual([
      '*timeout*',
      '*crash*',
    ]);
  });

  it('ANDs different fields and unwraps unary groups', () => {
    const expr = filterStateToExpression(
      state({
        Level: { included: ['error'] },
        ServiceName: { included: ['frontend-proxy'] },
      }),
    );
    expect(expr?.kind).toBe('group');
    const group = expr as FilterGroup;
    expect(group.op).toBe('AND');
    expect(group.children).toHaveLength(2);
  });

  it('nests same-field OR under a top-level AND', () => {
    const expr = filterStateToExpression(
      state({
        Level: { included: ['error'] },
        Body: { included: ['*timeout*', '*crash*'] },
        'http.status_code': { included: ['>=500'] },
      }),
    );
    expect(expr?.kind).toBe('group');
    const group = expr as FilterGroup;
    expect(group.op).toBe('AND');
    expect(group.children).toHaveLength(3);
    const orGroup = group.children[1] as FilterGroup;
    expect(orGroup.kind).toBe('group');
    expect(orGroup.op).toBe('OR');
    expect(orGroup.children).toHaveLength(2);
  });

  it('places excluded values as top-level AND clauses', () => {
    const expr = filterStateToExpression(
      state({
        Level: { excluded: ['info', 'debug'] },
      }),
    );
    expect(expr?.kind).toBe('group');
    const group = expr as FilterGroup;
    expect(group.op).toBe('AND');
    expect(group.children).toHaveLength(2);
    expect(group.children.every(c => (c as FilterClause).type === 'excluded'));
  });

  it('includes one-sided range clauses', () => {
    const expr = filterStateToExpression(
      state({ Duration: { range: { min: 1_000_000_000, minOp: '>' } } }),
    );
    expect(expr).toMatchObject({
      kind: 'clause',
      field: 'Duration',
      type: 'range',
      value: '>1000000000',
      range: { min: 1_000_000_000, minOp: '>' },
    });
  });
});

describe('shouldShowJoins', () => {
  it('hides AND when every child is a clause', () => {
    const expr = filterStateToExpression(
      state({
        Level: { included: ['error'] },
        ServiceName: { included: ['frontend-proxy'] },
      }),
    ) as FilterGroup;
    expect(shouldShowJoins(expr)).toBe(false);
  });

  it('shows joins for an OR group and a mixed AND', () => {
    const orExpr = filterStateToExpression(
      state({ Body: { included: ['*timeout*', '*crash*'] } }),
    ) as FilterGroup;
    expect(shouldShowJoins(orExpr)).toBe(true);

    const mixed = filterStateToExpression(
      state({
        Level: { included: ['error'] },
        Body: { included: ['*timeout*', '*crash*'] },
      }),
    ) as FilterGroup;
    expect(shouldShowJoins(mixed)).toBe(true);
  });
});

describe('removeFilterClause', () => {
  it('toggles an included value off and clears a range', () => {
    const setFilterValue = jest.fn();
    const clearFilter = jest.fn();
    expect(
      removeFilterClause(
        {
          kind: 'clause',
          field: 'Level',
          value: 'error',
          type: 'included',
          rawValue: 'error',
        },
        { setFilterValue, clearFilter },
      ),
    ).toBe(true);
    expect(setFilterValue).toHaveBeenCalledWith('Level', 'error', undefined);

    expect(
      removeFilterClause(
        {
          kind: 'clause',
          field: 'Duration',
          value: '100 – 200',
          type: 'range',
          range: { min: 100, max: 200 },
        },
        { setFilterValue, clearFilter },
      ),
    ).toBe(true);
    expect(clearFilter).toHaveBeenCalledWith('Duration');
  });
});

describe('lastClause', () => {
  it('returns the last leaf after nested OR', () => {
    const expr = filterStateToExpression(
      state({
        Level: { included: ['error'] },
        Body: { included: ['*timeout*', '*crash*'] },
      }),
    );
    expect(lastClause(expr)?.value).toBe('*crash*');
  });

  it('returns null when empty', () => {
    expect(lastClause(null)).toBeNull();
  });
});

describe('formatClauseLabel', () => {
  const included: FilterClause = {
    kind: 'clause',
    field: 'Level',
    value: 'error',
    type: 'included',
    rawValue: 'error',
  };
  const excluded: FilterClause = {
    ...included,
    type: 'excluded',
  };
  const range: FilterClause = {
    kind: 'clause',
    field: 'Duration',
    value: '100 – 200',
    type: 'range',
    range: { min: 100, max: 200 },
  };

  const openRange: FilterClause = {
    kind: 'clause',
    field: 'Duration',
    value: '>1000000000',
    type: 'range',
    range: { min: 1_000_000_000, minOp: '>' },
  };

  it('formats lucene include/exclude/range', () => {
    expect(formatClauseLabel(included, 'lucene')).toEqual({
      prefix: '',
      field: 'Level',
      operator: ':',
      value: 'error',
    });
    expect(formatClauseLabel(excluded, 'lucene')).toEqual({
      prefix: '-',
      field: 'Level',
      operator: ':',
      value: 'error',
    });
    expect(formatClauseLabel(range, 'lucene')).toEqual({
      prefix: '',
      field: 'Duration',
      operator: ':',
      value: '[100 TO 200]',
    });
  });

  it('formats sql include/exclude/range', () => {
    expect(formatClauseLabel(included, 'sql')).toEqual({
      prefix: '',
      field: 'Level',
      operator: ' = ',
      value: "'error'",
    });
    expect(formatClauseLabel(excluded, 'sql')).toEqual({
      prefix: '',
      field: 'Level',
      operator: ' != ',
      value: "'error'",
    });
    expect(formatClauseLabel(range, 'sql')).toEqual({
      prefix: '',
      field: 'Duration',
      operator: ' BETWEEN ',
      value: '100 AND 200',
    });
  });

  it('formats one-sided Slow spans comparisons', () => {
    expect(formatClauseLabel(openRange, 'lucene')).toEqual({
      prefix: '',
      field: 'Duration',
      operator: ':',
      value: '>1s',
    });
    expect(formatClauseLabel(openRange, 'sql')).toEqual({
      prefix: '',
      field: 'Duration',
      operator: ' > ',
      value: '1000000000',
    });
  });

  it('quotes lucene values that contain spaces', () => {
    expect(
      formatClauseLabel(
        { ...included, value: 'front end', rawValue: 'front end' },
        'lucene',
      ).value,
    ).toBe('"front end"');
  });
});
