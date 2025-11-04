import SqlString from 'sqlstring';
import { chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';

import { useMetadataWithSettings } from './useMetadata';

export type SpanAggregationRow = {
  serverServiceName: string;
  serverStatusCode: string;
  requestCount: number;
  clientServiceName?: string;
};

async function getServiceMapQuery({
  source,
  dateRange,
  traceId,
  metadata,
  samplingFactor,
}: {
  source: TSource;
  dateRange: [Date, Date];
  traceId?: string;
  metadata: Metadata;
  samplingFactor: number;
}) {
  // Don't sample if we're looking for a specific trace
  const effectiveSamplingLevel = traceId ? 1 : samplingFactor;

  const baseCTEConfig = {
    from: source.from,
    connection: source.connection,
    dateRange,
    timestampValueExpression: source.timestampValueExpression,
    filters: [
      // Sample a subset of traces, for performance in the following join
      {
        type: 'sql' as const,
        condition: `cityHash64(${source.traceIdExpression}) % ${effectiveSamplingLevel} = 0`,
      },
      // Optionally filter for a specific trace ID
      ...(traceId
        ? [
            {
              type: 'sql' as const,
              condition: SqlString.format('?? = ?', [
                source.traceIdExpression,
                traceId,
              ]),
            },
          ]
        : []),
    ],
    select: [
      {
        valueExpression: source.traceIdExpression ?? 'TraceId',
        alias: 'traceId',
      },
      {
        valueExpression: source.spanIdExpression ?? 'SpanId',
        alias: 'spanId',
      },
      {
        valueExpression: source.serviceNameExpression ?? 'ServiceName',
        alias: 'serviceName',
      },
      {
        valueExpression: source.parentSpanIdExpression ?? 'ParentSpanId',
        alias: 'parentSpanId',
      },
      {
        valueExpression: source.statusCodeExpression ?? 'StatusCode',
        alias: 'statusCode',
      },
    ],
  };

  const [serverCTE, clientCTE] = await Promise.all([
    renderChartConfig(
      {
        ...baseCTEConfig,
        filters: [
          ...baseCTEConfig.filters,
          {
            type: 'sql',
            condition: `${source.spanKindExpression} IN ('Server', 'Consumer')`,
          },
        ],
        where: '',
      },
      metadata,
    ),
    renderChartConfig(
      {
        ...baseCTEConfig,
        filters: [
          ...baseCTEConfig.filters,
          {
            type: 'sql',
            condition: `${source.spanKindExpression} IN ('Client', 'Producer')`,
          },
        ],
        where: '',
      },
      metadata,
    ),
  ]);

  // Left join to support services which receive requests from clients that are not instrumented.
  // Ordering helps ensure stable graph layout.
  return chSql`
    WITH 
      ServerSpans AS (${serverCTE}),
      ClientSpans AS (${clientCTE})
    SELECT
      ServerSpans.serviceName AS serverServiceName,
      ServerSpans.statusCode AS serverStatusCode,
      ClientSpans.serviceName AS clientServiceName,
      count(*) * ${{ Int64: effectiveSamplingLevel }} as requestCount
    FROM ServerSpans
      LEFT JOIN ClientSpans
        ON ServerSpans.traceId = ClientSpans.traceId
        AND ServerSpans.parentSpanId = ClientSpans.spanId
    WHERE (ClientSpans.serviceName IS NULL OR ServerSpans.serviceName != ClientSpans.serviceName)
    GROUP BY serverServiceName, serverStatusCode, clientServiceName
    ORDER BY serverServiceName, serverStatusCode, clientServiceName
  `;
}

type IncomingRequestStats = {
  totalRequests: number;
  requestCountByStatus: Map<string, number>;
  errorPercentage: number;
};

export type ServiceAggregation = {
  serviceName: string;
  incomingRequests: IncomingRequestStats;
  incomingRequestsByClient: Map<string, IncomingRequestStats>;
};

export function aggregateServiceMapData(data: SpanAggregationRow[]) {
  // Aggregate data by service
  const services = new Map<string, ServiceAggregation>();
  for (const row of data) {
    const {
      serverServiceName,
      serverStatusCode,
      clientServiceName,
      requestCount,
    } = row;

    if (!services.has(serverServiceName)) {
      services.set(serverServiceName, {
        serviceName: serverServiceName,
        incomingRequests: {
          totalRequests: 0,
          requestCountByStatus: new Map(),
          errorPercentage: 0,
        },
        incomingRequestsByClient: new Map(),
      });
    }

    const service = services.get(serverServiceName)!;

    // Add to total incoming request count
    service.incomingRequests.totalRequests += requestCount;

    // Add to request count per status
    const currentStatusCount =
      service.incomingRequests.requestCountByStatus.get(serverStatusCode) || 0;
    service.incomingRequests.requestCountByStatus.set(
      serverStatusCode,
      currentStatusCount + requestCount,
    );

    // Add to request count per client per status
    if (clientServiceName) {
      if (!service.incomingRequestsByClient.has(clientServiceName)) {
        service.incomingRequestsByClient.set(clientServiceName, {
          totalRequests: 0,
          requestCountByStatus: new Map(),
          errorPercentage: 0,
        });
      }

      const perClientStats =
        service.incomingRequestsByClient.get(clientServiceName)!;
      perClientStats.totalRequests += requestCount;

      const currentClientStatusCount =
        perClientStats.requestCountByStatus.get(serverStatusCode) || 0;
      perClientStats.requestCountByStatus.set(
        serverStatusCode,
        currentClientStatusCount + requestCount,
      );

      if (!services.has(clientServiceName)) {
        services.set(clientServiceName, {
          serviceName: clientServiceName,
          incomingRequests: {
            totalRequests: 0,
            requestCountByStatus: new Map(),
            errorPercentage: 0,
          },
          incomingRequestsByClient: new Map(),
        });
      }
    }
  }

  // Calculate error percentages for all services and their client stats
  for (const service of services.values()) {
    // Calculate error percentage for total incoming requests
    const errorCount =
      service.incomingRequests.requestCountByStatus.get('Error') || 0;
    service.incomingRequests.errorPercentage =
      service.incomingRequests.totalRequests > 0
        ? (errorCount / service.incomingRequests.totalRequests) * 100
        : 0;

    // Calculate error percentage for each client
    for (const clientStats of service.incomingRequestsByClient.values()) {
      const clientErrorCount =
        clientStats.requestCountByStatus.get('Error') || 0;
      clientStats.errorPercentage =
        clientStats.totalRequests > 0
          ? (clientErrorCount / clientStats.totalRequests) * 100
          : 0;
    }
  }

  return services;
}

export default function useServiceMap({
  source,
  dateRange,
  traceId,
  samplingFactor,
}: {
  source: TSource;
  dateRange: [Date, Date];
  traceId?: string;
  samplingFactor: number;
}) {
  const client = useClickhouseClient();
  const metadata = useMetadataWithSettings();

  return useQuery({
    queryKey: ['serviceMapData', traceId, source, dateRange, samplingFactor],
    queryFn: async ({ signal }) => {
      const query = await getServiceMapQuery({
        source,
        dateRange,
        traceId,
        metadata,
        samplingFactor,
      });

      const data = await client
        .query({
          query: query.sql,
          query_params: query.params,
          connectionId: source.connection,
          format: 'JSON',
          abort_signal: signal,
          clickhouse_settings: {
            max_execution_time: 60,
            join_algorithm: 'auto',
          },
        })
        .then(res => res.json<Record<string, string>>())
        .then(data =>
          data.data.map((row: Record<string, string>) => ({
            serverServiceName: row.serverServiceName,
            serverStatusCode: row.serverStatusCode,
            clientServiceName: row.clientServiceName,
            requestCount: Number.parseInt(row.requestCount),
          })),
        );

      return aggregateServiceMapData(data);
    },
    // Prevent refetching and updating the map layout
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
