import { useMemo, useState } from 'react';
import { isLogSource, isTraceSource } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Select,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
} from '@tabler/icons-react';

import { useMaterializationAnalysis } from '@/hooks/useMaterializationAnalysis/useMaterializationAnalysis';
import { useSources } from '@/source';
import { FormatTime } from '@/useFormatTime';

import AlreadyMaterializedAccordion from './AlreadyMaterializedAccordion';
import { MapReferencesRow } from './MapReferencesRow';

export default function MaterializedColumnsSection() {
  const { data: sources, isLoading: isLoadingSources } = useSources();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const selectedSource = useMemo(
    () => sources?.find(s => s.id === sourceId),
    [sources, sourceId],
  );

  const {
    combos,
    queriesFetched,
    queriesParsed,
    materializedReferences,
    searchedBackTo,
    hasNextPage,
    error,
    isDDLLoaded,
  } = useMaterializationAnalysis({
    source: selectedSource,
    enabled: isRunning,
  });

  // Whether work is actively being done — drives the Stop/Start affordance.
  // When history is exhausted, hasNextPage flips false and the auto-fetch
  // loop in useMaterializationAnalysis naturally idles even with isRunning
  // still true; we surface that as "complete" via hasNextPage in the UI.
  const isActive = isRunning && hasNextPage;

  const sourceOptions = useMemo(
    () =>
      (sources ?? [])
        .filter(s => isLogSource(s) || isTraceSource(s))
        .map(s => ({
          value: s.id,
          label: `${s.name} (${s.from.databaseName}.${s.from.tableName})`,
        })),
    [sources],
  );

  const canStart = !!selectedSource && isDDLLoaded;

  return (
    <Box>
      <Text size="md">Materialized Columns</Text>
      <Divider my="md" />
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Accessing map keys (e.g. <Code>LogAttributes['service.name']</Code>)
          can be relatively slow. Frequently-accessed keys can be materialized
          as separate columns on the source table. This tool inspects recent
          queries to identify frequently-accessed keys that aren't yet
          materialized.
        </Text>

        <Text size="xs" c="dimmed" fs="italic">
          Materializing columns is inexpensive, but does have an impact on
          ingestion throughput. Materialize only the most-frequently used keys.
        </Text>

        <Stack gap="sm">
          <Group align="end" wrap="wrap">
            <Select
              label="Source"
              placeholder="Select a source"
              data={sourceOptions}
              value={sourceId}
              onChange={value => {
                setSourceId(value);
                setIsRunning(false);
              }}
              disabled={isLoadingSources || isActive}
              searchable
              style={{ minWidth: 320 }}
            />
            {!isActive ? (
              <Button
                variant="primary"
                leftSection={<IconPlayerPlayFilled size={14} />}
                onClick={() => setIsRunning(true)}
                disabled={!canStart || (queriesFetched > 0 && !hasNextPage)}
              >
                {queriesFetched > 0 && !hasNextPage
                  ? 'Analysis complete'
                  : queriesFetched > 0
                    ? 'Resume analysis'
                    : 'Start analysis'}
              </Button>
            ) : (
              <Button
                variant="danger"
                leftSection={<IconPlayerStopFilled size={14} />}
                onClick={() => setIsRunning(false)}
              >
                Stop analysis
              </Button>
            )}
          </Group>

          {selectedSource && (
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                Inspected {queriesParsed.toLocaleString()} queries (back to{' '}
                {searchedBackTo ? (
                  <FormatTime value={searchedBackTo} format="short" />
                ) : (
                  '—'
                )}
                )
              </Text>
            </Group>
          )}
        </Stack>

        {error && (
          <Alert
            color="red"
            icon={<IconAlertTriangle size={16} />}
            title="Analysis error"
          >
            {error.message}
          </Alert>
        )}

        {selectedSource && (
          <AlreadyMaterializedAccordion references={materializedReferences} />
        )}

        {selectedSource && (
          <Card withBorder p={0}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Map keys</Table.Th>
                  <Table.Th>Queries</Table.Th>
                  <Table.Th>Total duration</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {combos.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={4}>
                      <Text size="sm" c="dimmed" ta="center" py="md">
                        {queriesFetched === 0
                          ? isActive
                            ? 'Fetching historical queries…'
                            : 'Click "Start analysis" to scan historical queries.'
                          : 'No un-materialized map keys referenced in these queries yet.'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  combos.map(combo => (
                    <MapReferencesRow
                      key={combo.refs
                        .map(k => `${k.column}:${k.key}`)
                        .join('|')}
                      referenceGroups={combo}
                      source={selectedSource}
                    />
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Card>
        )}
      </Stack>
    </Box>
  );
}
