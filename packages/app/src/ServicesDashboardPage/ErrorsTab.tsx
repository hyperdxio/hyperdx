import {
  DisplayType,
  isLogSource,
  isTraceSource,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Grid } from '@mantine/core';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import { DBTimeChart } from '@/components/DBTimeChart';
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import { useServiceDashboardExpressions } from '@/serviceDashboard';
import { useSource } from '@/source';

import { getScopedFilters, pickSourceConfigFields } from './helpers';
import { AppliedConfig } from './types';

// Errors Tab
function ErrorsTab({
  searchedTimeRange,
  appliedConfig,
}: {
  searchedTimeRange: [Date, Date];
  appliedConfig: AppliedConfig;
}) {
  const { data: source } = useSource({
    id: appliedConfig.source,
    kinds: [SourceKind.Trace],
  });
  const { expressions } = useServiceDashboardExpressions({ source });

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%">
      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          {source && expressions && (
            <DBTimeChart
              title="Error Events per Service"
              sourceId={source.id}
              config={{
                source: source.id,
                ...pickSourceConfigFields(source),
                where: appliedConfig.where || '',
                whereLanguage:
                  (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
                displayType: DisplayType.StackedBar,
                select: [
                  {
                    valueExpression: '',
                    aggFn: 'count',
                  },
                ],
                numberFormat: INTEGER_NUMBER_FORMAT,
                filters: [
                  {
                    type: 'sql',
                    condition: expressions.isError,
                  },
                  ...getScopedFilters({ appliedConfig, expressions }),
                ],
                groupBy:
                  (isLogSource(source) || isTraceSource(source)
                    ? source.serviceNameExpression
                    : undefined) || expressions.service,
                dateRange: searchedTimeRange,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

export default ErrorsTab;
