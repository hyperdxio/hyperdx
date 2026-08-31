import {
  getDashboardVariableDeclarations,
  getFilterVariableName,
  isFilterVariableEnabled,
} from '@hyperdx/common-utils/dist/filters';
import type { ChartVariable } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import type {
  ExternalDashboardFilter,
  ExternalDashboardFilterWithId,
} from '@/utils/zod';

/** Optional per-variable selection for a tile run. */
export const mcpVariableValuesParam = z
  .array(
    z.object({
      name: z
        .string()
        .describe(
          "Variable name, as declared by a filter's variableName. Get the " +
            'list from clickstack_get_dashboard.',
        ),
      values: z
        .array(z.string())
        .describe(
          'Values to treat as selected. An empty array means nothing is selected for this variable.',
        ),
    }),
  )
  .describe(
    'Optional simulated dashboard variable selection for this run. Every ' +
      'variable the dashboard declares defaults to EMPTY, which is the state a ' +
      'freshly-opened dashboard is in. Supply values here to check that a tile narrows ' +
      'as expected once the user picks something. Variables not listed stay empty.',
  );

export type McpVariableValues = z.infer<typeof mcpVariableValuesParam>;

/**
 * Build the variable context a dashboard tile runs with.
 *
 * The declarations come from the dashboard's variable-enabled filters, with
 * every selection empty by default.
 *
 * An unknown name in `variableValues` is an error rather than a silent no-op:
 * it is the agent's own input, and a typo would otherwise run the query with
 * the variable still empty and look like a data problem.
 */
export function resolveDashboardVariables(
  filters:
    | (ExternalDashboardFilter | ExternalDashboardFilterWithId)[]
    | undefined,
  variableValues: McpVariableValues | undefined,
): { variables: ChartVariable[] } | { error: string } {
  // Empty selection for every variable by default
  const variables: ChartVariable[] = getDashboardVariableDeclarations(
    filters,
  ).map(declaration => ({ ...declaration, values: [] }));

  if (!variableValues?.length) return { variables };

  const byName = new Map(variables.map(variable => [variable.name, variable]));
  const unknownVariableValues = variableValues
    .map(({ name }) => name)
    .filter(name => !byName.has(name));
  if (unknownVariableValues.length > 0) {
    const available =
      variables.length > 0
        ? variables.map(variable => variable.name).join(', ')
        : '(none)';
    return {
      error:
        `This dashboard declares no variable(s) named ${unknownVariableValues.join(', ')}. ` +
        `Available variables: ${available}. A variable exists only when a ` +
        'dashboard filter sets isVariableEnabled; check the filters returned ' +
        'by clickstack_get_dashboard.',
    };
  }

  // Override the default empty selection with the given variableValues
  for (const { name, values } of variableValues) {
    byName.get(name)!.values = values;
  }

  return { variables };
}

/** Set a derived variableName on filters without explicit variable names, so the agent doesn't guess. */
export function withResolvedFilterVariableNames(
  filters: ExternalDashboardFilterWithId[],
): ExternalDashboardFilterWithId[] {
  return filters.map(filter =>
    isFilterVariableEnabled(filter)
      ? { ...filter, variableName: getFilterVariableName(filter) }
      : filter,
  );
}
