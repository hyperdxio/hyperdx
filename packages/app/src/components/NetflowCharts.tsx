import { SimpleGrid, Stack } from '@mantine/core';

import {
  buildNetflowQueryConfigs,
  NETFLOW_ALIASES,
  NETFLOW_SUMMARY_TILES,
} from '@/netflow';
import { SankeyFilterHandler } from '@/netflowSankey';

import { ChartCard } from './charts/ChartCard';
import DBListBarChart from './DBListBarChart';
import DBNumberChart from './DBNumberChart';
import NetflowFilterMenu, { NetflowFilterHandler } from './NetflowFilterMenu';
import NetflowRecords from './NetflowRecords';
import NetflowVisualization from './NetflowVisualization';

export default function NetflowCharts({
  configs,
  onTimeRangeSelect,
  onFilter,
  onDimensionFilter,
}: {
  configs: ReturnType<typeof buildNetflowQueryConfigs>;
  onTimeRangeSelect: (start: Date, end: Date) => void;
  onFilter?: NetflowFilterHandler;
  onDimensionFilter?: SankeyFilterHandler;
}) {
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {NETFLOW_SUMMARY_TILES.map(({ title, column, numberFormat }) => (
          <ChartCard key={title} style={{ height: 155 }}>
            <DBNumberChart
              title={title}
              config={configs.summary}
              valueColumn={column}
              numberFormat={numberFormat}
            />
          </ChartCard>
        ))}
      </SimpleGrid>
      <NetflowVisualization
        configs={configs}
        onTimeRangeSelect={onTimeRangeSelect}
        onFilter={onDimensionFilter}
      />
      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
        {(
          [
            ['Top source addresses', configs.topSourceAddresses, 'srcAddr'],
            [
              'Top destination addresses',
              configs.topDestinationAddresses,
              'dstAddr',
            ],
            ['Protocols', configs.protocols, 'protocol'],
            ['Exporters', configs.exporters, 'exporter'],
            ['Input interfaces', configs.inInterfaces, 'inputInterface'],
            ['Output interfaces', configs.outInterfaces, 'outputInterface'],
          ] as const
        ).map(
          ([title, config, field]) =>
            config && (
              <ChartCard
                key={title}
                style={{ height: 330 }}
                data-testid={`netflow-breakdown-${field}`}
              >
                <DBListBarChart
                  title={title}
                  config={config}
                  groupColumn={NETFLOW_ALIASES.name}
                  valueColumn={NETFLOW_ALIASES.bytes}
                  hiddenSeries={[NETFLOW_ALIASES.name, NETFLOW_ALIASES.bytes]}
                  renderGroupLabel={value => (
                    <NetflowFilterMenu
                      field={field}
                      value={value}
                      onFilter={onFilter}
                    />
                  )}
                />
              </ChartCard>
            ),
        )}
      </SimpleGrid>
      <NetflowRecords
        key={JSON.stringify(configs.flows)}
        config={configs.flows}
        onFilter={onFilter}
      />
    </Stack>
  );
}
