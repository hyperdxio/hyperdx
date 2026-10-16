import { NumericUnit } from '@hyperdx/common-utils/dist/types';
import { ScrollArea, Table } from '@mantine/core';

import {
  NetflowSankeyData,
  SankeyDimension,
  SankeyFilterHandler,
} from '@/netflowSankey';
import { formatNumber } from '@/utils';

import NetflowFilterMenu from './NetflowFilterMenu';

export default function NetflowSankeyTable({
  data,
  dimensions,
  rangeSeconds,
  onFilter,
}: {
  data: NetflowSankeyData;
  dimensions: SankeyDimension[];
  rangeSeconds: number;
  onFilter?: SankeyFilterHandler;
}) {
  return (
    <ScrollArea mah={320} data-testid="netflow-sankey-table">
      <Table striped highlightOnHover fz="xs">
        <Table.Thead>
          <Table.Tr>
            {dimensions.map(dimension => (
              <Table.Th key={dimension.key}>{dimension.label}</Table.Th>
            ))}
            <Table.Th>Average bit rate</Table.Th>
            <Table.Th>Transferred bytes</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.paths.map(path => (
            <Table.Tr key={JSON.stringify(path.values)}>
              {dimensions.map((dimension, index) => (
                <Table.Td key={dimension.key}>
                  <NetflowFilterMenu
                    label={dimension.label}
                    value={path.values[index]}
                    allowEmpty
                    onSelect={
                      onFilter &&
                      (excluded =>
                        onFilter(dimension, path.values[index], excluded))
                    }
                  />
                </Table.Td>
              ))}
              <Table.Td>
                {formatNumber((path.value * 8) / rangeSeconds, {
                  output: 'data_rate',
                  numericUnit: NumericUnit.BitsSecSI,
                  mantissa: 2,
                })}
              </Table.Td>
              <Table.Td>
                {formatNumber(path.value, { output: 'byte', mantissa: 2 })}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
