import { parseAsStringEnum, useQueryState } from 'nuqs';
import { Group, SegmentedControl, Text } from '@mantine/core';

import { buildNetflowQueryConfigs } from '@/netflow';
import { SankeyFilterHandler } from '@/netflowSankey';

import { ChartCard } from './charts/ChartCard';
import { DBTimeChart } from './DBTimeChart';
import NetflowSankey from './NetflowSankey';

export default function NetflowVisualization({
  configs,
  onTimeRangeSelect,
  onFilter,
}: {
  configs: ReturnType<typeof buildNetflowQueryConfigs>;
  onTimeRangeSelect: (start: Date, end: Date) => void;
  onFilter?: SankeyFilterHandler;
}) {
  const [view, setView] = useQueryState(
    'netflowView',
    parseAsStringEnum(['traffic', 'sankey']).withDefault('traffic'),
  );
  return (
    <>
      <Group gap="sm">
        <Text size="sm">Visualization</Text>
        <SegmentedControl
          aria-label="Network visualization"
          value={view}
          onChange={value =>
            void setView(value === 'sankey' ? 'sankey' : 'traffic')
          }
          data={[
            { value: 'traffic', label: 'Time series' },
            { value: 'sankey', label: 'Sankey' },
          ]}
        />
      </Group>
      {view === 'sankey' ? (
        <NetflowSankey baseConfig={configs.totalBytes} onFilter={onFilter} />
      ) : (
        <ChartCard style={{ height: 300 }}>
          <DBTimeChart
            title="Network traffic"
            config={configs.traffic}
            onTimeRangeSelect={onTimeRangeSelect}
            disableDrillDown
          />
        </ChartCard>
      )}
    </>
  );
}
