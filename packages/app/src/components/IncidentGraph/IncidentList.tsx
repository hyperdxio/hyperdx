import { useMemo, useState } from 'react';
import cx from 'classnames';
import { Badge } from '@clickhouse/click-ui';
import {
  Group,
  ScrollArea,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { FormatTime } from '@/useFormatTime';

import { fromClickHouse } from './graphMapping';
import { filterIncidents, nodeName } from './incidentFlow';
import type { KgIncident } from './types';

import styles from './IncidentGraph.module.scss';

export const incidentRoute = (i: KgIncident) =>
  i.rootCauseNode
    ? `Alerted on ${nodeName(i.alertingNode)}, root cause ${nodeName(i.rootCauseNode)}`
    : `Alerted on ${nodeName(i.alertingNode)}`;

export function IncidentList({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: KgIncident[];
  selectedId: string | undefined;
  onSelect: (incidentId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => filterIncidents(incidents, query),
    [incidents, query],
  );

  return (
    <div className={styles.list}>
      <TextInput
        m="sm"
        size="xs"
        placeholder="Search by title or service"
        leftSection={<IconSearch size={14} />}
        value={query}
        onChange={e => setQuery(e.currentTarget.value)}
        data-testid="incident-list-search"
      />
      <ScrollArea style={{ flex: 1 }}>
        {shown.length === 0 ? (
          <EmptyState
            title="No matching incidents"
            description="Try another title or service name."
          />
        ) : (
          shown.map(i => (
            <UnstyledButton
              key={i.incidentId}
              className={cx(styles.listItem, {
                [styles.selected]: i.incidentId === selectedId,
              })}
              onClick={() => onSelect(i.incidentId)}
              data-testid={`incident-list-item-${i.incidentId}`}
            >
              <Text size="sm" fw={500} lineClamp={2}>
                {i.title}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {incidentRoute(i)}
              </Text>
              <Group gap={4} mt={4}>
                <Badge
                  size="sm"
                  text={i.status === 'open' ? 'Open' : 'Resolved'}
                  state={i.status === 'open' ? 'warning' : 'success'}
                />
                {i.confirmed && (
                  <Badge size="sm" text="Confirmed" state="info" />
                )}
              </Group>
              {i.resolvedAt && (
                <Text size="xxs" c="dimmed" mt={4}>
                  Resolved <FormatTime value={fromClickHouse(i.resolvedAt)} />
                </Text>
              )}
            </UnstyledButton>
          ))
        )}
      </ScrollArea>
    </div>
  );
}
