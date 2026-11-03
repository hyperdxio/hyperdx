import { Badge } from '@clickhouse/click-ui';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Group, Stack, Text } from '@mantine/core';

import { useSource } from '@/source';

import ServiceMap from './ServiceMap';

interface ServiceMapSidePanelProps {
  traceId: string;
  dateRange: [Date, Date];
  traceTableSourceId: string;
}

export default function ServiceMapSidePanel({
  traceId,
  dateRange,
  traceTableSourceId,
}: ServiceMapSidePanelProps) {
  const { data: traceTableSource } = useSource({ id: traceTableSourceId });

  return (
    <Stack w="100%">
      <Group gap={0}>
        <Text size="sm" ps="sm">
          Service Map
        </Text>
        <Badge
          size="sm"
          text="Beta"
          state="info"
          style={{ marginInlineStart: 'var(--mantine-spacing-xs)' }}
        />
      </Group>
      {traceTableSource && traceTableSource.kind === SourceKind.Trace ? (
        <ServiceMap
          traceTableSource={traceTableSource}
          traceId={traceId}
          dateRange={dateRange}
          isSingleTrace
        />
      ) : null}
    </Stack>
  );
}
