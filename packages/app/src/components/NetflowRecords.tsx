import { useMemo, useState } from 'react';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Drawer,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
} from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { NETFLOW_DIMENSION_LABELS, netflowColumnAlias } from '@/netflow';
import { useFormatTime } from '@/useFormatTime';
import { formatNumber } from '@/utils';

import { ChartCard } from './charts/ChartCard';
import ChartContainer from './charts/ChartContainer';
import ChartErrorState from './charts/ChartErrorState';
import EmptyState from './EmptyState';
import NetflowFilterMenu, { NetflowFilterHandler } from './NetflowFilterMenu';

const fields = [
  ['timestamp', 'Time'],
  ['srcAddr', NETFLOW_DIMENSION_LABELS.srcAddr],
  ['srcPort', 'Source port'],
  ['dstAddr', NETFLOW_DIMENSION_LABELS.dstAddr],
  ['dstPort', 'Destination port'],
  ['protocol', NETFLOW_DIMENSION_LABELS.protocol],
  ['exporter', NETFLOW_DIMENSION_LABELS.exporter],
  ['bytes', 'Bytes'],
  ['packets', 'Packets'],
  ['inputInterface', NETFLOW_DIMENSION_LABELS.inputInterface],
  ['outputInterface', NETFLOW_DIMENSION_LABELS.outputInterface],
  ['samplingRate', 'Sampling rate'],
  ['rawBytes', 'Raw bytes'],
  ['rawPackets', 'Raw packets'],
] as const;

export default function NetflowRecords({
  config,
  onFilter,
}: {
  config: BuilderChartConfigWithDateRange;
  onFilter?: NetflowFilterHandler;
}) {
  const { data, isLoading, error } = useQueriedChartConfig(config);
  const formatTime = useFormatTime();
  const [selected, setSelected] = useState<Record<string, unknown> | null>(
    null,
  );
  const rows = useMemo(
    () =>
      (data?.data ?? []).map(row =>
        Object.fromEntries(
          fields.map(([key]) => [key, row[netflowColumnAlias(key)]]),
        ),
      ),
    [data],
  );

  return (
    <>
      <ChartCard style={{ height: 440 }} data-testid="netflow-records">
        <ChartContainer
          title="Recent flow records"
          toolbarItems={[
            <Text
              key="count"
              size="xs"
              c="dimmed"
              style={{ whiteSpace: 'nowrap' }}
            >
              Latest {rows.length} records
              {config.limit?.limit != null && ` · limit ${config.limit.limit}`}
            </Text>,
          ]}
        >
          {error ? (
            <ChartErrorState error={error} />
          ) : isLoading ? (
            <Loader aria-label="Loading flow records" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No flow records found"
              description="Widen the time range or clear your filters to find network traffic."
            />
          ) : (
            <ScrollArea h="100%">
              <Table
                striped
                highlightOnHover
                withRowBorders
                fz="xs"
                style={{ whiteSpace: 'nowrap' }}
              >
                <Table.Thead>
                  <Table.Tr>
                    {[
                      'Time',
                      'Source',
                      'Destination',
                      'Protocol',
                      'Exporter',
                      'Bytes',
                      'Packets',
                      'Details',
                    ].map(label => (
                      <Table.Th key={label}>{label}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((row, index) => (
                    // Flow exports may contain duplicate records without an ID; the table remounts when its query changes.
                    // eslint-disable-next-line @eslint-react/no-array-index-key
                    <Table.Tr key={index}>
                      <Table.Td>{formatTime(String(row.timestamp))}</Table.Td>
                      <Table.Td>
                        <NetflowFilterMenu
                          field="srcAddr"
                          value={String(row.srcAddr ?? '')}
                          onFilter={onFilter}
                        />{' '}
                        · {String(row.srcPort)}
                      </Table.Td>
                      <Table.Td>
                        <NetflowFilterMenu
                          field="dstAddr"
                          value={String(row.dstAddr ?? '')}
                          onFilter={onFilter}
                        />{' '}
                        · {String(row.dstPort)}
                      </Table.Td>
                      <Table.Td>
                        <NetflowFilterMenu
                          field="protocol"
                          value={String(row.protocol ?? '')}
                          onFilter={onFilter}
                        />
                      </Table.Td>
                      <Table.Td>
                        <NetflowFilterMenu
                          field="exporter"
                          value={String(row.exporter ?? '')}
                          onFilter={onFilter}
                        />
                      </Table.Td>
                      <Table.Td>
                        {formatNumber(String(row.bytes), {
                          output: 'byte',
                          mantissa: 2,
                        })}
                      </Table.Td>
                      <Table.Td>
                        {formatNumber(String(row.packets), {
                          output: 'number',
                          thousandSeparated: true,
                        })}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          variant="link"
                          size="compact-xs"
                          onClick={() => setSelected(row)}
                          aria-label={`Inspect flow ${index + 1}`}
                        >
                          Inspect
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </ChartContainer>
      </ChartCard>
      <Drawer
        opened={selected !== null}
        onClose={() => setSelected(null)}
        position="right"
        title="Flow details"
        size="lg"
      >
        {selected && (
          <Stack>
            <Text size="sm" c="dimmed">
              Bytes and packets include sampling adjustment. Raw counters show
              the values received from the exporter.
            </Text>
            <Table withRowBorders>
              <Table.Tbody>
                {fields.map(([key, label]) => (
                  <Table.Tr key={key}>
                    <Table.Th>{label}</Table.Th>
                    <Table.Td style={{ overflowWrap: 'anywhere' }}>
                      {key === 'srcAddr' ||
                      key === 'dstAddr' ||
                      key === 'protocol' ||
                      key === 'exporter' ||
                      key === 'inputInterface' ||
                      key === 'outputInterface' ? (
                        <NetflowFilterMenu
                          field={key}
                          value={String(selected[key] ?? '')}
                          onFilter={onFilter}
                        />
                      ) : key === 'timestamp' ? (
                        formatTime(String(selected[key]))
                      ) : (
                        String(selected[key] ?? '—')
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </Drawer>
    </>
  );
}
