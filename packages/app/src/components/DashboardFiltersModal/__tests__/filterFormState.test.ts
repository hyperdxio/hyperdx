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

  it('rejects values the schema cannot accept', () => {
    expect(() =>
      toSavedFilter(formValues({ type: 'STATIC_LIST', options: [] })),
    ).toThrow();
  });
});
