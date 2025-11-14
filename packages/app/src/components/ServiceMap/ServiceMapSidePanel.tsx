import { Badge, Group, Stack, Text } from '@mantine/core';

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
        <Text size="sm" c="gray.2" ps="sm">
          Service Map
        </Text>
        <Badge
          size="xs"
          ms="xs"
          color="gray.4"
          autoContrast
          radius="sm"
          className="align-text-bottom"
        >
          Beta
        </Badge>
      </Group>
      {traceTableSource ? (
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
