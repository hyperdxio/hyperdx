import { DashboardFilter } from '@hyperdx/common-utils/dist/types';

import {
  getFilterEffect,
  getPendingVariablesTooltip,
} from '@/DashboardFilters';

const baseFilter: DashboardFilter = {
  id: 'filter1',
  type: 'QUERY_EXPRESSION',
  name: 'Service Name',
  expression: 'ServiceName',
  source: 'logs',
};

describe('getFilterEffect', () => {
  it('describes both effects when broadcast and variable are on', () => {
    expect(
      getFilterEffect({
        ...baseFilter,
        isBroadcastEnabled: true,
        isVariableEnabled: true,
        variableName: 'svc',
      }),
    ).toEqual({
      hasEffect: true,
      tooltip: 'Filters all sources, available as variable ($svc)',
    });
  });

  it('falls back to the name-derived variable token', () => {
    expect(
      getFilterEffect({ ...baseFilter, isVariableEnabled: true }).tooltip,
    ).toEqual('Filters all sources, available as variable ($Service_Name)');
  });

  it('describes only the broadcast when the variable is off', () => {
    expect(getFilterEffect(baseFilter)).toEqual({
      hasEffect: true,
      tooltip: 'Filters all sources',
    });
  });

  it('describes only the variable when broadcast is off', () => {
    expect(
      getFilterEffect({
        ...baseFilter,
        isBroadcastEnabled: false,
        isVariableEnabled: true,
        variableName: 'svc',
      }),
    ).toEqual({
      hasEffect: true,
      tooltip: 'Available as variable ($svc)',
    });
  });

  it('warns when neither effect is enabled', () => {
    expect(
      getFilterEffect({ ...baseFilter, isBroadcastEnabled: false }),
    ).toEqual({
      hasEffect: false,
      tooltip:
        'This filter neither broadcasts nor acts as a variable - it has no effect',
    });
  });

  it('warns when a variable-enabled filter has no usable token', () => {
    // A name with nothing token-safe in it derives to '', so the variable
    // could never be referenced — the same as having it switched off.
    expect(
      getFilterEffect({
        ...baseFilter,
        name: '!!!',
        isBroadcastEnabled: false,
        isVariableEnabled: true,
      }).hasEffect,
    ).toBe(false);
  });

  it('counts the scoped sources, singular and plural', () => {
    expect(
      getFilterEffect({ ...baseFilter, appliesToSourceIds: ['logs'] }).tooltip,
    ).toEqual('Filters 1 source');
    expect(
      getFilterEffect({ ...baseFilter, appliesToSourceIds: ['logs', 'traces'] })
        .tooltip,
    ).toEqual('Filters 2 sources');
  });

  it('describes a static filter as a variable only', () => {
    expect(
      getFilterEffect({
        id: 'filter2',
        type: 'STATIC_LIST',
        name: 'Environment',
        options: ['prod', 'staging', 'dev'],
        isBroadcastEnabled: false,
        isVariableEnabled: true,
        variableName: 'env',
      }),
    ).toEqual({
      hasEffect: true,
      tooltip: 'Available as variable ($env)',
    });
  });

  it('ignores the stored scope while broadcasting is off', () => {
    expect(
      getFilterEffect({
        ...baseFilter,
        appliesToSourceIds: ['logs'],
        isBroadcastEnabled: false,
        isVariableEnabled: true,
        variableName: 'svc',
      }).tooltip,
    ).toEqual('Available as variable ($svc)');
  });
});

describe('getPendingVariablesTooltip', () => {
  it('names the variable that has no selected value', () => {
    expect(getPendingVariablesTooltip(['svc'])).toBe(
      'Filter depends on $svc, which has no selected value.',
    );
  });

  it('agrees with more than one pending variable', () => {
    expect(getPendingVariablesTooltip(['svc', 'env'])).toContain(
      '$svc, $env, which have no selected value',
    );
  });
});
