import { Badge } from '@clickhouse/click-ui';
import {
  Code,
  Drawer,
  Group,
  List,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';

import { FormatTime } from '@/useFormatTime';

import { fromClickHouse } from './graphMapping';
import type { KgIncident } from './types';
import { usePlaybook } from './useIncidentGraph';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{children || '-'}</Text>
    </div>
  );
}

function PlaybookSection({ incidentId }: { incidentId: string }) {
  const { data, isLoading, error } = usePlaybook(incidentId);
  if (isLoading) return <Loader size="sm" />;
  if (error || !data) {
    return <Text variant="danger">Could not load the playbook.</Text>;
  }
  return (
    <Stack gap="sm">
      <Title order={5}>Playbook</Title>
      {data.steps.length === 0 ? (
        <Text size="sm" c="dimmed">
          No useful steps were recorded for this incident.
        </Text>
      ) : (
        <List type="ordered" spacing="sm" size="sm">
          {data.steps.map(step => (
            <List.Item key={step.seq}>
              {step.tool && <Code>{step.tool}</Code>} {step.summary}
              {step.reason && (
                <Text size="xs" c="dimmed">
                  Why: {step.reason}
                </Text>
              )}
            </List.Item>
          ))}
        </List>
      )}
      {data.ruledOut.length > 0 && (
        <>
          <Title order={6}>Ruled out</Title>
          <List spacing="xs" size="sm">
            {data.ruledOut.map(r => (
              <List.Item key={r.seq}>{r.summary}</List.Item>
            ))}
          </List>
        </>
      )}
    </Stack>
  );
}

export function IncidentDrawer({
  incident,
  onClose,
}: {
  incident: KgIncident | undefined;
  onClose: () => void;
}) {
  return (
    <Drawer
      opened={!!incident}
      onClose={onClose}
      position="right"
      size="md"
      title={incident?.title}
      data-testid="incident-graph-drawer"
    >
      {incident && (
        <Stack gap="md">
          <Group gap="xs">
            <Badge
              text={incident.status === 'open' ? 'Open' : 'Resolved'}
              state={incident.status === 'open' ? 'warning' : 'success'}
            />
            <Badge
              text={incident.confirmed ? 'Confirmed' : 'Not confirmed'}
              state={incident.confirmed ? 'info' : 'neutral'}
            />
          </Group>
          <Field label="Root cause">{incident.rootCause}</Field>
          <Field label="Root cause node">{incident.rootCauseNode}</Field>
          <Field label="Resolution">{incident.resolution}</Field>
          <Group grow>
            <Field label="Opened">
              <FormatTime value={fromClickHouse(incident.openedAt)} />
            </Field>
            <Field label="Resolved">
              {incident.resolvedAt && (
                <FormatTime value={fromClickHouse(incident.resolvedAt)} />
              )}
            </Field>
          </Group>
          {incident.status === 'resolved' && (
            <PlaybookSection incidentId={incident.incidentId} />
          )}
        </Stack>
      )}
    </Drawer>
  );
}
