import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  parseAsInteger,
  parseAsJson,
  parseAsString,
  useQueryState,
} from 'nuqs';
import { useForm } from 'react-hook-form';
import { DataFormat } from '@hyperdx/common-utils/dist/clickhouse';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Code,
  Grid,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';

import { ConnectionSelectControlled } from './components/ConnectionSelect';
import DBTableChart from './components/DBTableChart';
import { DBTimeChart } from './components/DBTimeChart';
import { SQLEditorControlled } from './components/SQLEditor';

function useBenchmarkQueryIds({
  queries,
  connections,
  iterations = 3,
}: {
  queries: readonly string[];
  connections: readonly string[];
  iterations?: number;
}) {
  const enabled = queries.length > 0 && connections.length > 0;
  const clickhouseClient = useClickhouseClient();

  return useQuery({
    enabled,
    queryKey: ['benchmark', queries, connections],
    queryFn: async () => {
      const shuffledQueries = queries.slice().sort(() => Math.random() - 0.5);
      const queryIds: Record<number, string[]> = {};

      for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < queries.length; j++) {
          // We can't easily get the query_id from the response, so we'll just
          // ask CH to use ours instead
          const queryId = crypto.randomUUID();

          await clickhouseClient
            .query({
              query: shuffledQueries[j],
              connectionId: connections[j],
              format: 'NULL' as DataFormat, // clickhouse doesn't have this under the client-js lib for some reason
              clickhouse_settings: {
                min_bytes_to_use_direct_io: '1',
                use_query_cache: 0,
                wait_end_of_query: 1,
              },
              queryId,
            })
            .then(res => res.text());

          queryIds[j] ??= [];
          queryIds[j].push(queryId);
        }
        // Wait 1s between queries
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Wait for the query log to flush
      await new Promise(resolve => setTimeout(resolve, 10000));

      return queryIds;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
}

function useEstimates(
  {
    queries,
    connections,
  }: {
    queries: string[];
    connections: string[];
  },
  options: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'> = {},
) {
  const clickhouseClient = useClickhouseClient();
  return useQuery({
    queryKey: ['estimate', queries, connections],
    queryFn: async () => {
      return Promise.all(
        queries.map((query, i) =>
          clickhouseClient
            .query({
              query: `EXPLAIN ESTIMATE ${query}`,
              format: 'JSON',
              connectionId: connections[i],
            })
            .then(res => res.json()),
        ),
      );
    },
    ...options,
  });
}

function useIndexes(
  {
    queries,
    connections,
  }: {
    queries: string[];
    connections: string[];
  },
  options: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'> = {},
) {
  const clickhouseClient = useClickhouseClient();
  return useQuery({
    queryKey: ['indexes', queries, connections],
    queryFn: async () => {
      return Promise.all(
        queries.map((query, i) =>
          clickhouseClient
            .query({
              query: `EXPLAIN indexes=1, json=1, description = 0 ${query}`,
              format: 'TabSeparatedRaw',
              connectionId: connections[i],
            })
            .then(res => res.text())
            .then(res => JSON.parse(res)),
        ),
      );
    },
    ...options,
  });
}

function BenchmarkPage() {
  const [queries, setQueries] = useQueryState(
    'queries',
    parseAsJson<string[]>(v => v as string[]),
  );
  const [connections, setConnections] = useQueryState(
    'connections',
    parseAsJson<string[]>(v => v as string[]),
  );
  const [iterations, setIterations] = useQueryState<number>(
    'iterations',
    parseAsInteger.withDefault(3),
  );
  const { control, handleSubmit } = useForm({
    values: {
      queries: queries || [],
      connections,
      iterations,
    },
  });

  const onSubmit = (data: any) => {
    if (
      !data.queries[0] ||
      !data.queries[1] ||
      !data.connections[0] ||
      !data.connections[1]
    ) {
      return;
    }
    setQueries(data.queries || []);
    setConnections(data.connections || []);
    setIterations(data.iterations);
  };

  const _queries = useMemo(() => queries || [], [queries]);
  const _connections = useMemo(() => connections || [], [connections]);

  const { data: estimates } = useEstimates(
    { queries: _queries, connections: _connections },
    {
      enabled: _queries.length > 0 && _connections.length > 0,
    },
  );

  const { data: indexes } = useIndexes(
    { queries: _queries, connections: _connections },
    {
      enabled: _queries.length > 0 && _connections.length > 0,
    },
  );

  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);

  const { data: queryIds, isLoading: isQueryIdsLoading } = useBenchmarkQueryIds(
    {
      queries: _queries,
      connections: _connections,
      iterations,
    },
  );

  // Hack to get time range
  useEffect(() => {
    if (_queries.length > 0 && _connections.length > 0) {
      setStartTime(new Date(Date.now() - 1000));
    }
  }, [_queries, _connections]);
  useEffect(() => {
    if (queryIds != null && queryIds[0] != null) {
      setEndTime(
        new Date(
          Date.now() - 1000 * 9, // minus hard-coded flush interval
        ),
      );
    }
  }, [queryIds]);

  return (
    <div className="p-4">
      <Title order={1} fw={400} mb="md">
        Clickhouse Query Benchmark
      </Title>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Stack gap="md">
          <Grid>
            <Grid.Col span={6}>
              <Stack>
                <Text size="lg">Query 1</Text>
                <ConnectionSelectControlled
                  control={control}
                  name="connections.0"
                />
                <SQLEditorControlled control={control} name="queries.0" />
              </Stack>
            </Grid.Col>
            <Grid.Col span={6}>
              <Stack>
                <Text size="lg">Query 2</Text>
                <ConnectionSelectControlled
                  control={control}
                  name="connections.1"
                />
                <SQLEditorControlled control={control} name="queries.1" />
              </Stack>
            </Grid.Col>
          </Grid>
          <Button variant="primary" type="submit" loading={isQueryIdsLoading}>
            Run Benchmark
          </Button>
          {isQueryIdsLoading && (
            <Text ta="center" c="green" size="xl">
              Running Benchmark...
            </Text>
          )}
        </Stack>
        <Grid mt="md">
          <Grid.Col span={12}>
            <Stack>
              <Text size="lg">Query Estimate & Indexes</Text>
              <Text size="sm">Index utilization of your query</Text>
            </Stack>
          </Grid.Col>
          <Grid.Col span={6}>
            <Stack>
              <Table>
                <Table.Tbody>
                  {Object.entries(estimates?.[0].data?.[0] ?? {}).map(
                    ([key, value]) => (
                      <Table.Tr key={key}>
                        <Table.Td>{key}</Table.Td>
                        <Table.Td>{`${value}`}</Table.Td>
                      </Table.Tr>
                    ),
                  )}
                </Table.Tbody>
              </Table>
              <Code block style={{ maxHeight: 350, overflow: 'auto' }}>
                {JSON.stringify(indexes?.[0] ?? {}, null, 2)
                  .replace(/\},/g, '')
                  .replace(/[[\]{}]/g, '')
                  .replace(/\n\s*\n/g, '\n\n')
                  .trim()}
              </Code>
            </Stack>
          </Grid.Col>
          <Grid.Col span={6}>
            <Stack>
              <Table>
                <Table.Tbody>
                  {Object.entries(estimates?.[1].data?.[0] ?? {}).map(
                    ([key, value]) => (
                      <Table.Tr key={key}>
                        <Table.Td>{key}</Table.Td>
                        <Table.Td>{`${value}`}</Table.Td>
                      </Table.Tr>
                    ),
                  )}
                </Table.Tbody>
              </Table>
              <Code block style={{ maxHeight: 350, overflow: 'auto' }}>
                {JSON.stringify(indexes?.[1] ?? {}, null, 2)
                  .replace(/\},/g, '')
                  .replace(/[[\]{}]/g, '')
                  .replace(/\n\s*\n/g, '\n\n')
                  .trim()}
              </Code>
            </Stack>
          </Grid.Col>
          <Grid.Col span={12}>
            <Stack>
              {queryIds != null &&
                queryIds[0] != null &&
                startTime != null &&
                endTime != null && (
                  <div
                    className="flex-grow-1 d-flex flex-column"
                    style={{ minHeight: 400 }}
                  >
                    <DBTimeChart
                      config={{
                        select: [
                          {
                            aggFn: 'max',
                            valueExpression: 'query_duration_ms',
                            aggCondition: `query_id IN [${(queryIds?.[0] ?? [])
                              .map(v => `'${v}'`)
                              .join(',')}]`,
                            aggConditionLanguage: 'sql',
                            alias: `Query 1 Duration`,
                          },
                          {
                            aggFn: 'max',
                            valueExpression: 'query_duration_ms',
                            aggCondition: `query_id IN [${(queryIds?.[1] ?? [])
                              .map(v => `'${v}'`)
                              .join(',')}]`,
                            aggConditionLanguage: 'sql',
                            alias: `Query 2 Duration`,
                          },
                        ],
                        displayType: DisplayType.Line,
                        // dateRange: [new Date(Date.now() - 1000 * 60 * 2), new Date()],
                        dateRange: [startTime, endTime],
                        connection: _connections[0],
                        timestampValueExpression: 'event_time',
                        from: {
                          databaseName: 'system',
                          tableName: 'query_log',
                        },
                        granularity: '1 second' as const,
                        where: '',
                        fillNulls: false,
                      }}
                      showDisplaySwitcher={false}
                    />
                  </div>
                )}
              {queryIds != null &&
                queryIds[0] != null &&
                startTime != null &&
                endTime != null && (
                  <div
                    className="flex-grow-1 d-flex flex-column"
                    style={{ minHeight: 400 }}
                  >
                    <DBTableChart
                      config={{
                        select: [
                          {
                            aggFn: 'max',
                            aggCondition: '',
                            valueExpression: 'query_duration_ms',
                            alias: `Max Duration`,
                          },
                          {
                            aggFn: 'avg',
                            aggCondition: '',
                            valueExpression: 'query_duration_ms',
                            alias: `Avg Duration`,
                          },
                          {
                            aggFn: 'min',
                            aggCondition: '',
                            valueExpression: 'query_duration_ms',
                            alias: `Min Duration`,
                          },
                          {
                            aggFn: 'max',
                            aggCondition: '',
                            valueExpression: `read_rows`,
                            alias: `Rows Read`,
                          },
                          {
                            aggFn: 'max',
                            aggCondition: '',
                            valueExpression: `ProfileEvents['OSReadBytes']`,
                            alias: `Disk Bytes Read`,
                          },
                          {
                            aggFn: 'max',
                            aggCondition: '',
                            valueExpression: `formatReadableSize(memory_usage)`,
                            alias: `Memory`,
                          },
                          {
                            aggFn: 'max',
                            aggCondition: '',
                            valueExpression: `ProfileEvents['SystemTimeMicroseconds'] / 1000`,
                            alias: `System Time (ms)`,
                          },
                          {
                            aggFn: 'max',
                            aggCondition: '',
                            valueExpression: `ProfileEvents['UserTimeMicroseconds'] / 1000`,
                            alias: `User Time (ms)`,
                          },
                        ],
                        dateRange: [startTime, endTime],
                        connection: _connections[0],
                        timestampValueExpression: 'event_time',
                        from: {
                          databaseName: 'system',
                          tableName: 'query_log',
                        },
                        groupBy: `if (query_id IN [${(queryIds?.[0] ?? [])
                          .map(v => `'${v}'`)
                          .join(',')}], 'Query 1', 'Query 2') as Query`,
                        where: '',
                      }}
                    />
                  </div>
                )}
            </Stack>
          </Grid.Col>
        </Grid>
      </form>
    </div>
  );
}

const BenchmarkPageDynamic = dynamic(async () => BenchmarkPage, { ssr: false });

export default BenchmarkPageDynamic;
