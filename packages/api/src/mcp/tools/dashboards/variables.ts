import {
  getDashboardVariableDeclarations,
  getDashboardVariableFilters,
  getFilterVariableName,
  isFilterVariableEnabled,
  isStaticListFilter,
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
          'Values to treat as selected. An empty array means nothing is selected for this variable. ' +
            "For a STATIC_LIST filter's variable, every value must be one of the filter's declared options.",
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

  // A static filter's dropdown can only ever offer its declared options, so a
  // simulated selection outside them can never occur in the UI — reject it as
  // a typo rather than running a query the dashboard cannot produce.
  const staticOptionsByName = buildStaticOptionsByName(filters);
  const optionErrors = variableValues.flatMap(({ name, values }) => {
    const options = staticOptionsByName.get(name);
    if (!options) return [];
    const invalid = values.filter(value => !options.includes(value));
    if (invalid.length === 0) return [];
    return [
      `Variable "${name}" belongs to a STATIC_LIST filter and only accepts its declared ` +
        `options; value(s) ${invalid.map(value => `"${value}"`).join(', ')} are not among them. ` +
        `Declared options: ${formatOptionsPreview(options)}. See the filter's options via ` +
        'clickstack_get_dashboard, or change them with clickstack_save_dashboard.',
    ];
  });
  if (optionErrors.length > 0) {
    return { error: optionErrors.join('\n') };
  }

  // Override the default empty selection with the given variableValues
  for (const { name, values } of variableValues) {
    byName.get(name)!.values = values;
  }

  return { variables };
}

/** Options of each static filter, keyed by the variable name it answers to. */
function buildStaticOptionsByName(
  filters: ExternalDashboardFilter[] | undefined,
): Map<string, string[]> {
  const optionsByName = new Map<string, string[]>();
  for (const { filter, name } of getDashboardVariableFilters(filters)) {
    if (isStaticListFilter(filter)) optionsByName.set(name, filter.options);
  }
  return optionsByName;
}

const OPTIONS_PREVIEW_LIMIT = 20;

// Options allow up to 1000 entries of 10k characters each; keep the error legible.
function formatOptionsPreview(options: string[]): string {
  const preview = options.slice(0, OPTIONS_PREVIEW_LIMIT).join(', ');
  const remaining = options.length - OPTIONS_PREVIEW_LIMIT;
  return remaining > 0 ? `${preview}, … and ${remaining} more` : preview;
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
