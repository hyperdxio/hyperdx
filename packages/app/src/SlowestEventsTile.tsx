import { Card, Flex, Text } from '@mantine/core';

import api from './api';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';

export default function SlowestEventsTile({
  dateRange,
  height,
  scopeWhereQuery,
  title,
}: {
  dateRange: [Date, Date];
  height: number;
  scopeWhereQuery: (where: string) => string;
  title: React.ReactNode;
}) {
  const { data, isError, isLoading } = api.useMultiSeriesChart({
    series: [
      {
        type: 'table',
        aggFn: 'p95',
        field: 'duration',
        groupBy: [],
        table: 'logs',
        where: scopeWhereQuery(''),
      },
    ],
    endDate: dateRange[1] ?? new Date(),
    startDate: dateRange[0] ?? new Date(),
    seriesReturnType: 'column',
  });

  const p95 = data?.data?.[0]?.['series_0.data'];

  const roundedP95 = Math.round(p95 ?? 0);

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        <Flex justify="space-between">
          {title}
          <Text size="xs" c="dark.2">
            (Slower than {roundedP95}ms)
          </Text>
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={height}>
        {isLoading ? (
          <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
            Calculating...
          </div>
        ) : isError || p95 == null ? (
          <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
            Error Calculating
          </div>
        ) : (
          <LogTableWithSidePanel
            config={{
              dateRange,
              where: scopeWhereQuery(`duration:>${roundedP95}`),
              columns: ['duration'],
            }}
            isLive={false}
            isUTC={false}
            setIsUTC={() => {}}
            onPropertySearchClick={() => {}}
          />
        )}
      </Card.Section>
    </Card>
  );
}
