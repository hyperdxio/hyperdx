import { useMemo } from 'react';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { MaterializedViewConfiguration } from '@hyperdx/common-utils/dist/types';
import { Grid, Group, Pill, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

import { FormatTime } from '@/useFormatTime';

export default function MVConfigSummary({
  config,
}: {
  config: MaterializedViewConfiguration;
}) {
  const dimensionColumnsSplit = useMemo(
    () => splitAndTrimWithBracket(config.dimensionColumns),
    [config.dimensionColumns],
  );

  const columnsAndAggFns = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { sourceColumn = '', aggFn } of config.aggregatedColumns) {
      if (map.has(sourceColumn)) {
        map.get(sourceColumn)?.push(aggFn);
      } else {
        map.set(sourceColumn, [aggFn]);
      }
    }
    return Array.from(map.entries()).sort(([sourceColA], [sourceColB]) =>
      sourceColA.localeCompare(sourceColB),
    );
  }, [config.aggregatedColumns]);

  return (
    <Stack gap="md">
      <Grid columns={2}>
        <Grid.Col span={1}>
          <Group align="center" mb="xs" gap="xs">
            <Text size="sm" fw={500}>
              Granularity
            </Text>
            <Tooltip
              multiline
              maw={400}
              label={`
              The size of the time buckets into which data is pre-aggregated. 
              Aggregate values can vary slightly between materialized views and the base source 
              table when the selected time range does not align with the view's granularity.
            `}
            >
              <IconInfoCircle size={16} />
            </Tooltip>
          </Group>

          <Pill>{config.minGranularity}</Pill>
        </Grid.Col>
        {config.minDate && (
          <Grid.Col span={1}>
            <Text size="sm" fw={500} mb="xs">
              Minimum Date
            </Text>
            <Pill>
              <FormatTime value={config.minDate} format="withYear" />
            </Pill>
          </Grid.Col>
        )}
      </Grid>

      <div>
        <Text size="sm" fw={500} mb="xs">
          Available Group and Filter Columns
        </Text>
        <Group gap="xs">
          {dimensionColumnsSplit.map(col => (
            <Pill key={col}>{col}</Pill>
          ))}
        </Group>
      </div>

      <div>
        <Text size="sm" fw={500} mb="sm">
          Available Aggregated Columns
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Column</Table.Th>
              <Table.Th>Aggregation</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {columnsAndAggFns.map(([sourceColumn, aggFns]) => (
              <Table.Tr key={sourceColumn}>
                <Table.Td>{sourceColumn}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {aggFns.map(aggFn => (
                      <Pill key={aggFn}>{aggFn}</Pill>
                    ))}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </Stack>
  );
}
