import { z } from 'zod';

import { validateDashboardFilterVariableNames } from '@/dashboardValidation';

type TestFilter = {
  name: string;
  variableName?: string;
  isVariableEnabled?: boolean;
};

/** Run the refinement in isolation and return the issues it raised. */
const collectIssues = (
  filters: TestFilter[],
  paths?: { filtersPath?: (string | number)[] },
) => {
  const schema = z
    .object({})
    .superRefine((_, ctx) =>
      validateDashboardFilterVariableNames(filters, ctx, paths),
    );
  const result = schema.safeParse({});
  return result.success ? [] : result.error.issues;
};

const variableFilter = (overrides: Partial<TestFilter>): TestFilter => ({
  name: 'Service',
  isVariableEnabled: true,
  ...overrides,
});

describe('validateDashboardFilterVariableNames', () => {
  it('accepts an empty filter list', () => {
    expect(collectIssues([])).toEqual([]);
  });

  it('accepts distinct variable names', () => {
    expect(
      collectIssues([
        variableFilter({ name: 'Service', variableName: 'service' }),
        variableFilter({ name: 'Environment', variableName: 'environment' }),
      ]),
    ).toEqual([]);
  });

  it('reports the second filter that takes an already-used name', () => {
    const issues = collectIssues([
      variableFilter({ name: 'Service', variableName: 'service' }),
      variableFilter({ name: 'Service (traces)', variableName: 'service' }),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['filters', 1, 'variableName']);
    expect(issues[0].message).toBe('Variable names must be unique: "service"');
  });

  it('reports every later duplicate, not just the first', () => {
    const issues = collectIssues([
      variableFilter({ variableName: 'service' }),
      variableFilter({ variableName: 'service' }),
      variableFilter({ variableName: 'service' }),
    ]);

    expect(issues.map(i => i.path)).toEqual([
      ['filters', 1, 'variableName'],
      ['filters', 2, 'variableName'],
    ]);
  });

  it('detects a clash against a name derived from the display name', () => {
    const issues = collectIssues([
      variableFilter({ name: 'Total Requests' }),
      variableFilter({ name: 'Other', variableName: 'Total_Requests' }),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe(
      'Variable names must be unique: "Total_Requests"',
    );
  });

  it('compares names case-sensitively, matching the form', () => {
    expect(
      collectIssues([
        variableFilter({ variableName: 'env' }),
        variableFilter({ variableName: 'ENV' }),
      ]),
    ).toEqual([]);
  });

  // The backwards-compatibility guarantee: nobody who left the feature off can
  // be blocked by this check, even though the check itself always runs.
  it('ignores filters whose variables are disabled', () => {
    expect(
      collectIssues([
        variableFilter({ variableName: 'service', isVariableEnabled: false }),
        variableFilter({
          variableName: 'service',
          isVariableEnabled: undefined,
        }),
        { name: 'Service' },
        { name: 'Service' },
      ]),
    ).toEqual([]);
  });

  it('does not let a disabled filter reserve a name', () => {
    expect(
      collectIssues([
        variableFilter({ variableName: 'service', isVariableEnabled: false }),
        variableFilter({ variableName: 'service' }),
      ]),
    ).toEqual([]);
  });

  it('still reports a clash between enabled filters that sit either side of a disabled one', () => {
    const issues = collectIssues([
      variableFilter({ variableName: 'service' }),
      variableFilter({ variableName: 'service', isVariableEnabled: false }),
      variableFilter({ variableName: 'service' }),
    ]);

    expect(issues.map(i => i.path)).toEqual([['filters', 2, 'variableName']]);
  });

  // A variable-enabled filter that resolves to nothing would persist a variable no
  // tile could reference, so it is rejected rather than skipped.
  it('requires a name when the display name yields nothing token-safe', () => {
    const issues = collectIssues([variableFilter({ name: '环境' })]);

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['filters', 0, 'variableName']);
    expect(issues[0].message).toBe(
      'Variable name is required for filter "环境"',
    );
  });

  it('reports each unresolvable filter rather than treating them as duplicates', () => {
    const issues = collectIssues([
      variableFilter({ name: '环境' }),
      variableFilter({ name: '!!!' }),
    ]);

    expect(issues.map(i => i.path)).toEqual([
      ['filters', 0, 'variableName'],
      ['filters', 1, 'variableName'],
    ]);
    expect(issues.map(i => i.message)).toEqual([
      'Variable name is required for filter "环境"',
      'Variable name is required for filter "!!!"',
    ]);
  });

  it('accepts an unresolvable display name when an explicit variable name is set', () => {
    expect(
      collectIssues([variableFilter({ name: '环境', variableName: 'env' })]),
    ).toEqual([]);
  });

  it('ignores an unresolvable name when the filter is not variable-enabled', () => {
    expect(
      collectIssues([
        variableFilter({ name: '环境', isVariableEnabled: false }),
        variableFilter({ name: '环境', isVariableEnabled: undefined }),
        { name: '环境' },
      ]),
    ).toEqual([]);
  });

  it('honors a custom filters path', () => {
    const issues = collectIssues(
      [
        variableFilter({ variableName: 'service' }),
        variableFilter({ variableName: 'service' }),
      ],
      { filtersPath: ['body', 'filters'] },
    );

    expect(issues[0].path).toEqual(['body', 'filters', 1, 'variableName']);
  });
});
