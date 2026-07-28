import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('services');
  const { data: traceTableSource } = useSource({ id: traceTableSourceId });

  return (
    <Stack w="100%">
      <Group gap={0}>
        <Text size="sm" ps="sm">
          {t('map.title')}
        </Text>
        <Badge size="xs" ms="xs" color="gray" autoContrast radius="sm">
          {t('map.beta')}
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
