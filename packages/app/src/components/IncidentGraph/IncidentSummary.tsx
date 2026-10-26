import { Badge } from '@clickhouse/click-ui';
import {
  Group,
  Paper,
  Spoiler,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';

import { FormatTime } from '@/useFormatTime';
import { formatDurationMs } from '@/utils';

import { fromClickHouse } from './graphMapping';
import type { KgIncident } from './types';

export function resolvedAfter(i: KgIncident): string | null {
  if (!i.resolvedAt) return null;
  const ms =
    Date.parse(fromClickHouse(i.resolvedAt)) -
    Date.parse(fromClickHouse(i.openedAt));
  const secs = Math.max(0, Math.round(ms / 1000));
  return secs === 0 ? 'under a second' : formatDurationMs(secs * 1000);
}

export function IncidentHeader({ incident }: { incident: KgIncident }) {
  const after = resolvedAfter(incident);
  return (
    <div>
      <Group gap="xs" wrap="nowrap">
        <Title order={4} lineClamp={1}>
          {incident.title}
        </Title>
        <Badge
          text={incident.status === 'open' ? 'Open' : 'Resolved'}
          state={incident.status === 'open' ? 'warning' : 'success'}
        />
        <Tooltip
          label={`Confirmed by ${incident.confirmedBy}`}
          disabled={!incident.confirmed}
        >
          <span>
            <Badge
              text={incident.confirmed ? 'Confirmed' : 'Not confirmed'}
              state={incident.confirmed ? 'info' : 'neutral'}
            />
          </span>
        </Tooltip>
      </Group>
      <Text size="xs" c="dimmed" mt={2}>
        Opened <FormatTime value={fromClickHouse(incident.openedAt)} />
        {after && ` · resolved after ${after}`}
      </Text>
    </div>
  );
}

function Paragraph({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={500}>
        {label}
      </Text>
      {/* About three lines of body text before the toggle. */}
      <Spoiler maxHeight={66} showLabel="Show more" hideLabel="Show less">
        <Text size="sm" ff="text" style={{ whiteSpace: 'pre-wrap' }}>
          {text || '-'}
        </Text>
      </Spoiler>
    </div>
  );
}

export function IncidentSummary({ incident }: { incident: KgIncident }) {
  const { rootCause, resolution } = incident;
  return (
    <Paper withBorder p="sm" data-testid="incident-summary">
      {incident.status === 'open' ? (
        <Text size="sm" c="dimmed">
          No root cause recorded yet.
        </Text>
      ) : rootCause.trim() === resolution.trim() ? (
        <Paragraph label="Root cause and resolution" text={rootCause} />
      ) : (
        <Stack gap="sm">
          <Paragraph label="Root cause" text={rootCause} />
          <Paragraph label="Resolution" text={resolution} />
        </Stack>
      )}
    </Paper>
  );
}
