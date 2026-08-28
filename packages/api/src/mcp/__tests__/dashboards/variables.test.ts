import mongoose from 'mongoose';

import {
  resolveDashboardVariables,
  withResolvedFilterVariableNames,
} from '@/mcp/tools/dashboards/variables';
import type { ExternalDashboardFilterWithId } from '@/utils/zod';

const sourceId = new mongoose.Types.ObjectId().toString();

function filter(
  overrides: Partial<ExternalDashboardFilterWithId> = {},
): ExternalDashboardFilterWithId {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    type: 'QUERY_EXPRESSION',
    name: 'Service',
    expression: 'ServiceName',
    sourceId,
    whereLanguage: 'sql',
    ...overrides,
  } as ExternalDashboardFilterWithId;
}

const variableFilter = filter({
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  variableName: 'service',
});

describe('resolveDashboardVariables', () => {
  it('returns an empty array for a dashboard with no filters', () => {
    // Empty, not undefined: an empty array still registers $__filter and
    // $__conditionalAll as macros, so a tile using one against a dashboard
    // that declares nothing fails with a message about the variable rather
    // than leaking macro text into ClickHouse.
    expect(resolveDashboardVariables(undefined, undefined)).toEqual({
      variables: [],
    });
    expect(resolveDashboardVariables([], undefined)).toEqual({
      variables: [],
    });
  });

  it('declares nothing for a broadcast-only filter', () => {
    expect(resolveDashboardVariables([filter()], undefined)).toEqual({
      variables: [],
    });
  });

  it('defaults every declared variable to an empty selection', () => {
    expect(resolveDashboardVariables([variableFilter], undefined)).toEqual({
      variables: [{ name: 'service', expression: 'ServiceName', values: [] }],
    });
  });

  it('applies a supplied selection', () => {
    expect(
      resolveDashboardVariables(
        [variableFilter],
        [{ name: 'service', values: ['checkout'] }],
      ),
    ).toEqual({
      variables: [
        { name: 'service', expression: 'ServiceName', values: ['checkout'] },
      ],
    });
  });

  it('leaves variables the caller did not mention empty', () => {
    const env = filter({
      name: 'Environment',
      expression: 'Env',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'env',
    });

    const resolved = resolveDashboardVariables(
      [variableFilter, env],
      [{ name: 'service', values: ['checkout'] }],
    );

    expect(resolved).toEqual({
      variables: [
        { name: 'service', expression: 'ServiceName', values: ['checkout'] },
        { name: 'env', expression: 'Env', values: [] },
      ],
    });
  });

  it('rejects a name the dashboard does not declare', () => {
    const resolved = resolveDashboardVariables(
      [variableFilter],
      [{ name: 'tenant', values: ['acme'] }],
    );

    expect(resolved).toHaveProperty('error');
    if (!('error' in resolved)) throw new Error('expected an error');
    expect(resolved.error).toContain('tenant');
    expect(resolved.error).toContain('Available variables: service');
  });

  it('lists (none) when the dashboard declares no variables at all', () => {
    const resolved = resolveDashboardVariables(
      [filter()],
      [{ name: 'service', values: ['checkout'] }],
    );

    if (!('error' in resolved)) throw new Error('expected an error');
    expect(resolved.error).toContain('Available variables: (none)');
  });

  it('lets the last entry win on a repeated name', () => {
    const resolved = resolveDashboardVariables(
      [variableFilter],
      [
        { name: 'service', values: ['a'] },
        { name: 'service', values: ['b'] },
      ],
    );

    expect(resolved).toEqual({
      variables: [
        { name: 'service', expression: 'ServiceName', values: ['b'] },
      ],
    });
  });
});

describe('withResolvedFilterVariableNames', () => {
  it('leaves a broadcast-only filter untouched', () => {
    const broadcastOnly = filter();
    expect(withResolvedFilterVariableNames([broadcastOnly])).toEqual([
      broadcastOnly,
    ]);
  });

  it('leaves an explicit variableName untouched', () => {
    expect(withResolvedFilterVariableNames([variableFilter])).toEqual([
      variableFilter,
    ]);
  });

  it('fills in the name derived from the display name when omitted', () => {
    const noExplicitName = filter({
      name: 'Service Name',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: undefined,
    });

    expect(withResolvedFilterVariableNames([noExplicitName])).toEqual([
      { ...noExplicitName, variableName: 'Service_Name' },
    ]);
  });
});
