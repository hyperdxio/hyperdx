import { ChartVariable } from '@hyperdx/common-utils/dist/types';
import { Box, Text } from '@mantine/core';

/**
 * Documents the dashboard variables a tile can reference, and how.
 * Renders nothing when variables is undefined or empty.
 */
export function RawSqlVariableInstructions({
  variables,
}: {
  variables: ChartVariable[] | undefined;
}) {
  if (!variables?.length) {
    return null;
  }

  return (
    <Box mb="xs">
      <Text size="xs" fw="bold">
        Dashboard variables
      </Text>
      <Text size="xs">
        This chart may reference the following variables from the dashboard:{' '}
        {variables.map(variable => `$${variable.name}`).join(', ')}.
      </Text>

      <Text size="xs">
        Prefer using the $__filter and $__conditionalAll macros when referencing
        variables, to ensure that the query remains valid when a variable has no
        selection.
      </Text>
    </Box>
  );
}
