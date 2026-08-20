import { z } from 'zod';

import {
  validateDashboardFilterFieldGating,
  validateDashboardFilterModes,
  validateDashboardFilterVariableNames,
} from '@/dashboardValidation';

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

type ModeFilter = {
  name: string;
  isBroadcastEnabled?: boolean;
  isVariableEnabled?: boolean;
};

const collectModeIssues = (
  filters: ModeFilter[],
  paths?: { filtersPath?: (string | number)[] },
) => {
  const schema = z
    .object({})
    .superRefine((_, ctx) => validateDashboardFilterModes(filters, ctx, paths));
  const result = schema.safeParse({});
  return result.success ? [] : result.error.issues;
};

describe('validateDashboardFilterModes', () => {
  it('accepts an empty filter list', () => {
    expect(collectModeIssues([])).toEqual([]);
  });

  // The shape every filter had before the two flags existed. Rejecting these
  // would break every dashboard already stored.
  it('accepts a filter that carries neither flag', () => {
    expect(collectModeIssues([{ name: 'Service' }])).toEqual([]);
  });

  it('accepts a filter with either mode on', () => {
    expect(
      collectModeIssues([
        { name: 'Broadcast only', isBroadcastEnabled: true },
        {
          name: 'Variable only',
          isBroadcastEnabled: false,
          isVariableEnabled: true,
        },
        {
          name: 'Both',
          isBroadcastEnabled: true,
          isVariableEnabled: true,
        },
      ]),
    ).toEqual([]);
  });

  it('rejects a filter with both modes off', () => {
    const issues = collectModeIssues([
      {
        name: 'Service',
        isBroadcastEnabled: false,
        isVariableEnabled: false,
      },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['filters', 0, 'isBroadcastEnabled']);
    expect(issues[0].message).toBe(
      'Filter "Service" must broadcast its value, be available as a variable, or both',
    );
  });

  it('treats an omitted variable flag as off', () => {
    expect(
      collectModeIssues([{ name: 'Service', isBroadcastEnabled: false }]),
    ).toHaveLength(1);
  });

  it('reports every offending filter, by index', () => {
    const issues = collectModeIssues([
      { name: 'Fine', isBroadcastEnabled: true },
      { name: 'Broken A', isBroadcastEnabled: false },
      { name: 'Broken B', isBroadcastEnabled: false, isVariableEnabled: false },
    ]);

    expect(issues.map(i => i.path)).toEqual([
      ['filters', 1, 'isBroadcastEnabled'],
      ['filters', 2, 'isBroadcastEnabled'],
    ]);
  });

  it('honors a custom filters path', () => {
    const issues = collectModeIssues(
      [{ name: 'Service', isBroadcastEnabled: false }],
      { filtersPath: ['body', 'filters'] },
    );

    expect(issues[0].path).toEqual([
      'body',
      'filters',
      0,
      'isBroadcastEnabled',
    ]);
  });
});

type GatingFilter = ModeFilter & {
  variableName?: string;
  appliesToSourceIds?: string[];
};

const collectGatingIssues = (
  filters: GatingFilter[],
  paths?: { filtersPath?: (string | number)[] },
) => {
  const schema = z
    .object({})
    .superRefine((_, ctx) =>
      validateDashboardFilterFieldGating(filters, ctx, paths),
    );
  const result = schema.safeParse({});
  return result.success ? [] : result.error.issues;
};

describe('validateDashboardFilterFieldGating', () => {
  it('accepts an empty filter list', () => {
    expect(collectGatingIssues([])).toEqual([]);
  });

  it('accepts a filter that carries neither field', () => {
    expect(collectGatingIssues([{ name: 'Service' }])).toEqual([]);
  });

  it('accepts each field in the mode that uses it', () => {
    expect(
      collectGatingIssues([
        {
          name: 'Variable',
          isVariableEnabled: true,
          variableName: 'service',
        },
        {
          name: 'Broadcast',
          isBroadcastEnabled: true,
          appliesToSourceIds: ['source-1'],
        },
        {
          name: 'Both',
          isVariableEnabled: true,
          variableName: 'environment',
          appliesToSourceIds: ['source-1'],
        },
      ]),
    ).toEqual([]);
  });

  it('rejects a variableName on a filter that is not variable-enabled', () => {
    const issues = collectGatingIssues([
      { name: 'Service', variableName: 'service' },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['filters', 0, 'variableName']);
    expect(issues[0].message).toBe(
      'Filter "Service" sets variableName but is not available as a variable; set isVariableEnabled to true or drop variableName',
    );
  });

  it('rejects a variableName when the variable is explicitly disabled', () => {
    expect(
      collectGatingIssues([
        { name: 'Service', isVariableEnabled: false, variableName: 'service' },
      ]),
    ).toHaveLength(1);
  });

  it('rejects appliesToSourceIds on a filter that does not broadcast', () => {
    const issues = collectGatingIssues([
      {
        name: 'Service',
        isBroadcastEnabled: false,
        isVariableEnabled: true,
        appliesToSourceIds: ['source-1'],
      },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['filters', 0, 'appliesToSourceIds']);
    expect(issues[0].message).toBe(
      'Filter "Service" sets appliesToSourceIds but does not broadcast its value; set isBroadcastEnabled to true or drop appliesToSourceIds',
    );
  });

  // An empty array is what "applies to all tiles" looks like, so it restricts
  // nothing and cannot contradict a disabled broadcast.
  it('accepts an empty appliesToSourceIds on a non-broadcasting filter', () => {
    expect(
      collectGatingIssues([
        {
          name: 'Service',
          isBroadcastEnabled: false,
          isVariableEnabled: true,
          appliesToSourceIds: [],
        },
      ]),
    ).toEqual([]);
  });

  // Missing means broadcasting, so a filter that predates the flag keeps its
  // scope.
  it('accepts appliesToSourceIds when the broadcast flag is omitted', () => {
    expect(
      collectGatingIssues([
        { name: 'Service', appliesToSourceIds: ['source-1'] },
      ]),
    ).toEqual([]);
  });

  it('reports both fields on one filter, and every offending filter', () => {
    const issues = collectGatingIssues([
      { name: 'Fine', isVariableEnabled: true, variableName: 'service' },
      {
        name: 'Both wrong',
        isBroadcastEnabled: false,
        variableName: 'environment',
        appliesToSourceIds: ['source-1'],
      },
      { name: 'Stray name', variableName: 'region' },
    ]);

    expect(issues.map(i => i.path)).toEqual([
      ['filters', 1, 'variableName'],
      ['filters', 1, 'appliesToSourceIds'],
      ['filters', 2, 'variableName'],
    ]);
  });

  it('honors a custom filters path', () => {
    const issues = collectGatingIssues(
      [{ name: 'Service', variableName: 'service' }],
      { filtersPath: ['body', 'filters'] },
    );

    expect(issues[0].path).toEqual(['body', 'filters', 0, 'variableName']);
  });
});
