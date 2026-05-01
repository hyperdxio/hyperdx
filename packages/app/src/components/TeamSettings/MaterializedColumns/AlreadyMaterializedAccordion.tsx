import { useMemo } from 'react';
import { Accordion, Badge, Group, Stack, Text } from '@mantine/core';

import { MapKeyReference } from '@/hooks/useMaterializationAnalysis/useMaterializationAnalysis.shared';

import { ColumnKeyList } from './ColumnKeyList';

export default function AlreadyMaterializedAccordion({
  references,
}: {
  references: MapKeyReference[];
}) {
  const referencesGroupedByColumn = useMemo(() => {
    const keysByColumn = references.reduce((keysByColumn, key) => {
      const arr = keysByColumn.get(key.column);
      if (arr) arr.push(key.key);
      else keysByColumn.set(key.column, [key.key]);
      return keysByColumn;
    }, new Map<string, string[]>());

    return Array.from(keysByColumn.entries())
      .map(([column, keys]) => ({
        column,
        keys: keys.toSorted(),
      }))
      .sort((a, b) => (a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
  }, [references]);

  return (
    <Accordion variant="separated" chevronPosition="left">
      <Accordion.Item value="already-materialized">
        <Accordion.Control>
          <Group gap="xs">
            <Text size="sm">Already materialized</Text>
            <Badge variant="light" color="gray">
              {references.length}
            </Badge>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          {referencesGroupedByColumn.length === 0 ? (
            <Text size="sm" c="dimmed">
              No map keys are currently materialized as columns on this source.
            </Text>
          ) : (
            <Stack gap="md">
              {referencesGroupedByColumn.map(({ column, keys }) => (
                <ColumnKeyList key={column} column={column} keys={keys} />
              ))}
            </Stack>
          )}
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
