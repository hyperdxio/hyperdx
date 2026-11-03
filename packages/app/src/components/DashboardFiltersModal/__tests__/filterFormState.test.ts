import { DashboardFilter } from '@hyperdx/common-utils/dist/types';

import {
  FilterFormValues,
  toFormValues,
  toSavedFilter,
} from '@/components/DashboardFiltersModal/filterFormState';

/** Form values as the editor holds them: every field, whatever the type. */
const formValues = (
  overrides: Partial<FilterFormValues>,
): FilterFormValues => ({
  ...toFormValues(),
  id: 'a',
  ...overrides,
});

describe('toFormValues', () => {
  it('seeds both types fields for a new filter', () => {
    const values = toFormValues(undefined, 'logs');

    expect(values).toMatchObject({
      type: 'QUERY_EXPRESSION',
      name: '',
      source: 'logs',
      expression: '',
      options: [],
      isBroadcastEnabled: true,
      isVariableEnabled: false,
    });
    expect(values.id).toEqual(expect.any(String));
  });

  it('carries a stored static filter into the queried fields as blanks', () => {
    const values = toFormValues({
      id: 'a',
      type: 'STATIC_LIST',
      name: 'Environment',
      options: ['prod'],
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'env',
    });

    expect(values).toMatchObject({
      id: 'a',
      type: 'STATIC_LIST',
      options: ['prod'],
      variableName: 'env',
      expression: '',
      source: '',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
    });
  });

  it('seeds the shared source field from a stored PromQL label filter', () => {
    const values = toFormValues({
      id: 'a',
      type: 'PROMETHEUS_LABEL',
      name: 'Job',
      source: 'prom',
      label: 'job',
      match: 'up{job="api"}',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'job',
    });

    expect(values).toMatchObject({
      id: 'a',
      type: 'PROMETHEUS_LABEL',
      source: 'prom',
      label: 'job',
      match: 'up{job="api"}',
      variableName: 'job',
      expression: '',
      options: [],
      isBroadcastEnabled: false,
      isVariableEnabled: true,
    });
  });

  it('seeds the ad hoc fields from a stored ad hoc filter', () => {
    const values = toFormValues({
      id: 'a',
      type: 'ADHOC',
      name: 'Conditions',
      sourceType: 'promql',
      sources: ['prom'],
      appliesToSourceIds: ['prom-2'],
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'conds',
    });

    expect(values).toMatchObject({
      type: 'ADHOC',
      sourceType: 'promql',
      sources: ['prom'],
      appliesToSourceIds: ['prom-2'],
      variableName: 'conds',
      isBroadcastEnabled: false,
    });
  });

  it('defaults a new filter to SQL ad hoc sources', () => {
    expect(toFormValues()).toMatchObject({ sourceType: 'sql', sources: [] });
  });
});

describe('toSavedFilter', () => {
  it('drops the queried fields from a static filter', () => {
    const saved = toSavedFilter(
      formValues({
        type: 'STATIC_LIST',
        name: 'Environment',
        options: [' prod ', 'staging'],
        // Left behind by the queried editor before the type was switched.
        expression: 'Env',
        source: 'logs',
        where: 'x = 1',
      }),
    );

    expect(saved).toEqual({
      id: 'a',
      type: 'STATIC_LIST',
      name: 'Environment',
      options: ['prod', 'staging'],
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'Environment',
    });
  });

  it('drops the static options from a queried filter', () => {
    const saved = toSavedFilter(
      formValues({
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'ServiceName',
        source: 'logs',
        where: '  ',
        appliesToSourceIds: [],
        options: ['prod'],
      }),
    );

    expect(saved).toEqual({
      id: 'a',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'ServiceName',
      source: 'logs',
      isBroadcastEnabled: true,
      isVariableEnabled: false,
    });
  });

  it('keeps only the PromQL fields on a PromQL label filter', () => {
    const saved = toSavedFilter(
      formValues({
        type: 'PROMETHEUS_LABEL',
        name: 'Job',
        source: 'prom',
        label: '  job  ',
        // Left behind by the other editors before the type was switched.
        expression: 'Env',
        where: 'x = 1',
        options: ['prod'],
      }),
    );

    expect(saved).toEqual({
      id: 'a',
      type: 'PROMETHEUS_LABEL',
      name: 'Job',
      source: 'prom',
      label: 'job',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'Job',
    });
  });

  it('trims a PromQL label filter selector and drops an empty one', () => {
    const base = {
      type: 'PROMETHEUS_LABEL' as const,
      name: 'Job',
      source: 'prom',
      label: 'job',
    };

    expect(
      toSavedFilter(formValues({ ...base, match: '  up{job="api"}  ' })),
    ).toMatchObject({ match: 'up{job="api"}' });
    expect(toSavedFilter(formValues({ ...base, match: '   ' }))).toMatchObject({
      match: undefined,
    });
  });

  it('rejects a PromQL label filter without a source', () => {
    expect(() =>
      toSavedFilter(
        formValues({
          type: 'PROMETHEUS_LABEL',
          name: 'Job',
          source: '',
          label: 'job',
        }),
      ),
    ).toThrow();
  });

  it('keeps only the ad hoc fields on an ad hoc filter', () => {
    const saved = toSavedFilter(
      formValues({
        type: 'ADHOC',
        name: 'Conditions',
        sourceType: 'sql',
        sources: ['logs', 'traces'],
        appliesToSourceIds: ['logs'],
        // Left behind by the other editors before the type was switched.
        expression: 'Env',
        source: 'logs',
        options: ['prod'],
        isRequired: true,
        isSingleSelect: true,
      }),
    );

    expect(saved).toEqual({
      id: 'a',
      type: 'ADHOC',
      name: 'Conditions',
      sourceType: 'sql',
      sources: ['logs', 'traces'],
      appliesToSourceIds: ['logs'],
      isBroadcastEnabled: true,
      isVariableEnabled: true,
      variableName: 'Conditions',
    });
  });

  it('drops the ad hoc broadcast scope when broadcast is off', () => {
    const saved = toSavedFilter(
      formValues({
        type: 'ADHOC',
        name: 'Conditions',
        sources: ['logs'],
        appliesToSourceIds: ['logs'],
        isBroadcastEnabled: false,
      }),
    );

    expect(saved).toMatchObject({
      isBroadcastEnabled: false,
      appliesToSourceIds: undefined,
    });
  });

  it('rejects an ad hoc filter without sources', () => {
    expect(() =>
      toSavedFilter(formValues({ type: 'ADHOC', name: 'Conditions' })),
    ).toThrow();
  });

  it('rejects values the schema cannot accept', () => {
    expect(() =>
      toSavedFilter(formValues({ type: 'STATIC_LIST', options: [] })),
    ).toThrow();
  });
});

/** The minimum a form needs to save, per filter type the form supports. */
const byType: Record<
  Exclude<DashboardFilter['type'], 'ADHOC'>,
  Partial<FilterFormValues>
> = {
  QUERY_EXPRESSION: {
    type: 'QUERY_EXPRESSION',
    name: 'Service',
    expression: 'ServiceName',
    source: 'logs',
  },
  STATIC_LIST: {
    type: 'STATIC_LIST',
    name: 'Environment',
    options: ['prod'],
  },
  PROMETHEUS_LABEL: {
    type: 'PROMETHEUS_LABEL',
    name: 'Job',
    source: 'prom',
    label: 'job',
  },
};
const variants = Object.entries(byType);

describe('minSelections', () => {
  it.each(variants)(
    'reads a stored minimum back onto the %s form',
    (_type, filter) => {
      const saved = toSavedFilter(formValues({ ...filter, isRequired: true }));

      expect(saved).toMatchObject({ minSelections: 1 });
      expect(toFormValues(saved).isRequired).toBe(true);
    },
  );

  // Absent rather than 0, so an optional filter's API payload is unchanged.
  it.each(variants)(
    'emits no key at all for an optional %s filter',
    (_type, filter) => {
      const saved = toSavedFilter(formValues({ ...filter, isRequired: false }));

      expect(saved).not.toHaveProperty('minSelections');
      expect(toFormValues(saved).isRequired).toBe(false);
    },
  );

  it('never leaks the form-only isRequired field into the saved filter', () => {
    expect(
      toSavedFilter(
        formValues({ ...byType.QUERY_EXPRESSION, isRequired: true }),
      ),
    ).not.toHaveProperty('isRequired');
  });

  it('defaults a new filter to optional', () => {
    expect(toFormValues().isRequired).toBe(false);
  });
});

describe('isGlobalRequirement', () => {
  it('defaults a new filter to blocking only the tiles that use it', () => {
    expect(toFormValues().isGlobalRequirement).toBe(false);
  });

  it.each(variants)(
    'stores a dashboard-wide %s requirement and reads it back onto the form',
    (_type, filter) => {
      const saved = toSavedFilter(
        formValues({ ...filter, isRequired: true, isGlobalRequirement: true }),
      );

      expect(saved).toMatchObject({ isGlobalRequirement: true });
      expect(toFormValues(saved).isGlobalRequirement).toBe(true);
    },
  );

  // Absent rather than false, so a required filter's payload carries only the
  // field that turns the requirement on.
  it.each(variants)(
    'emits no key for a %s filter that blocks only its own tiles',
    (_type, filter) => {
      const saved = toSavedFilter(
        formValues({ ...filter, isRequired: true, isGlobalRequirement: false }),
      );

      expect(saved).not.toHaveProperty('isGlobalRequirement');
      expect(toFormValues(saved).isGlobalRequirement).toBe(false);
    },
  );

  // The scope is meaningless without a requirement, so an unchecked "Required"
  // must not leave the wider block behind on the stored filter.
  it.each(variants)(
    'emits no key for an optional %s filter',
    (_type, filter) => {
      expect(
        toSavedFilter(
          formValues({
            ...filter,
            isRequired: false,
            isGlobalRequirement: true,
          }),
        ),
      ).not.toHaveProperty('isGlobalRequirement');
    },
  );
});

describe('maxSelections', () => {
  it.each(variants)(
    'round-trips single-select on a %s filter',
    (_type, filter) => {
      const saved = toSavedFilter(
        formValues({ ...filter, isSingleSelect: true }),
      );

      expect(saved).toMatchObject({ maxSelections: 1 });
      expect(saved).not.toHaveProperty('isSingleSelect');
      expect(toFormValues(saved).isSingleSelect).toBe(true);
    },
  );

  it.each(variants)(
    'emits no key at all for a multi-select %s filter',
    (_type, filter) => {
      const saved = toSavedFilter(
        formValues({ ...filter, isSingleSelect: false }),
      );

      expect(saved).not.toHaveProperty('maxSelections');
      expect(toFormValues(saved).isSingleSelect).toBe(false);
    },
  );
  it('keeps both limits on a filter that is single-select and required', () => {
    const saved = toSavedFilter(
      formValues({
        ...byType.STATIC_LIST,
        isSingleSelect: true,
        isRequired: true,
      }),
    );

    expect(saved).toMatchObject({ minSelections: 1, maxSelections: 1 });
  });
});
