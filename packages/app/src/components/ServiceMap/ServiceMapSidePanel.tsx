import { Trans } from 'next-i18next/pages';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
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
        <Text size="sm" ps="sm">
          <Trans>Service Map</Trans>
        </Text>
        <Badge size="xs" ms="xs" color="gray" autoContrast radius="sm">
          <Trans>Beta</Trans>
        </Badge>
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
