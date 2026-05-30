import SqlString from 'sqlstring';
import { chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';

import { useMetadataWithSettings } from './useMetadata';

export type SpanAggregationRow = {
  serverServiceName: string;
  clientServiceName?: string;
  // True for node-level (rolled-up across all callers) rows, false for
  // edge-level (a specific client→server call) rows. Derived from GROUPING()
  // over the client service in the GROUPING SETS query.
  isNodeLevel: boolean;
  requestCount: number;
  errorCount: number;
  // Latency percentiles in raw duration units. Undefined when the source has
  // no duration expression. Convert with rawDurationToMs for display.
  p50?: number;
  p95?: number;
  p99?: number;
};

async function getServiceMapQuery({
  source,
  dateRange,
  traceId,
  metadata,
  samplingFactor,
  where,
  whereLanguage,
  serviceNames,
}: {
  source: TTraceSource;
  dateRange: [Date, Date];
  traceId?: string;
  metadata: Metadata;
  samplingFactor: number;
  where?: string;
  whereLanguage?: 'sql' | 'lucene';
  serviceNames?: string[];
}) {
  // Don't sample if we're looking for a specific trace
  const effectiveSamplingLevel = traceId ? 1 : samplingFactor;

  const baseCTEConfig = {
    from: source.from,
    connection: source.connection,
    dateRange,
    timestampValueExpression: source.timestampValueExpression,
    ...(source.implicitColumnExpression != null
      ? { implicitColumnExpression: source.implicitColumnExpression }
      : {}),
    where: where || '',
    whereLanguage: whereLanguage ?? 'lucene',
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
      // Carry the raw span duration through so we can aggregate latency.
      // Only available when the source defines a duration expression.
      ...(source.durationExpression
        ? [
            {
              valueExpression: source.durationExpression,
              alias: 'duration',
            },
          ]
        : []),
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
            condition: `${source.spanKindExpression} IN ('Server', 'Consumer', 'SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER')`,
          },
        ],
      },
      metadata,
      source.querySettings,
    ),
    renderChartConfig(
      {
        ...baseCTEConfig,
        filters: [
          ...baseCTEConfig.filters,
          {
            type: 'sql',
            condition: `${source.spanKindExpression} IN ('Client', 'Producer', 'SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER')`,
          },
        ],
      },
      metadata,
      source.querySettings,
    ),
  ]);

  const serviceNameInList = serviceNames?.length
    ? { UNSAFE_RAW_SQL: serviceNames.map(s => SqlString.escape(s)).join(', ') }
    : null;
  const serviceNameFilter = serviceNameInList
    ? chSql`AND (
        ServerSpans.serviceName IN (${serviceNameInList})
        OR ClientSpans.serviceName IN (${serviceNameInList})
      )`
    : chSql``;

  // Latency percentiles over the server spans. Empty fragment when the source
  // has no duration expression. Percentiles can't be combined client-side, so
  // they're computed server-side per grouping set (see GROUPING SETS below).
  // One quantiles(...) call maintains a single reservoir sketch for all three
  // percentiles, ~3x cheaper than three separate quantile() aggregations.
  const latencySelect = source.durationExpression
    ? chSql`,
      quantiles(0.5, 0.95, 0.99)(ServerSpans.duration) as quantiles`
    : chSql``;

  // Left join to support services which receive requests from clients that are
  // not instrumented. GROUPING SETS emits, in one pass, both a per-edge row
  // (server + client) and a rolled-up per-service node row (server only);
  // GROUPING() flags which is which so node and edge percentiles are each
  // computed over the right set of spans. Ordering helps stable graph layout.
  return chSql`
    WITH
      ServerSpans AS (${serverCTE}),
      ClientSpans AS (${clientCTE})
    SELECT
      ServerSpans.serviceName AS serverServiceName,
      ClientSpans.serviceName AS clientServiceName,
      GROUPING(ClientSpans.serviceName) AS isNodeLevel,
      count(*) * ${{ Int64: effectiveSamplingLevel }} as requestCount,
      countIf(ServerSpans.statusCode = 'Error') * ${{ Int64: effectiveSamplingLevel }} as errorCount${latencySelect}
    FROM ServerSpans
      LEFT JOIN ClientSpans
        ON ServerSpans.traceId = ClientSpans.traceId
        AND ServerSpans.parentSpanId = ClientSpans.spanId
    WHERE (ClientSpans.serviceName IS NULL OR ServerSpans.serviceName != ClientSpans.serviceName)
      ${serviceNameFilter}
    GROUP BY GROUPING SETS (
      (ServerSpans.serviceName, ClientSpans.serviceName),
      (ServerSpans.serviceName)
    )
    ORDER BY serverServiceName, isNodeLevel, clientServiceName
  `;
}

export type IncomingRequestStats = {
  totalRequests: number;
  errorCount: number;
  errorPercentage: number;
  // Latency percentiles in raw duration units. Convert with
  // rawDurationToMs(value, source.durationPrecision) for display.
  p50: number;
  p95: number;
  p99: number;
  // Whether latency percentiles are available (source has a duration column).
  hasLatency: boolean;
};

export type ServiceAggregation = {
  serviceName: string;
  incomingRequests: IncomingRequestStats;
  incomingRequestsByClient: Map<string, IncomingRequestStats>;
  // Total requests this service makes to others (sum of edges where it is the
  // client). Combined with incoming traffic to size the node by total
  // throughput.
  outgoingRequests: number;
};

function emptyStats(): IncomingRequestStats {
  return {
    totalRequests: 0,
    errorCount: 0,
    errorPercentage: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    hasLatency: false,
  };
}

function statsFromRow(row: SpanAggregationRow): IncomingRequestStats {
  return {
    totalRequests: row.requestCount,
    errorCount: row.errorCount,
    errorPercentage:
      row.requestCount > 0 ? (row.errorCount / row.requestCount) * 100 : 0,
    p50: row.p50 ?? 0,
    p95: row.p95 ?? 0,
    p99: row.p99 ?? 0,
    hasLatency: row.p50 != null,
  };
}

export function aggregateServiceMapData(data: SpanAggregationRow[]) {
  const services = new Map<string, ServiceAggregation>();

  const ensureService = (name: string): ServiceAggregation => {
    let service = services.get(name);
    if (!service) {
      service = {
        serviceName: name,
        incomingRequests: emptyStats(),
        incomingRequestsByClient: new Map(),
        outgoingRequests: 0,
      };
      services.set(name, service);
    }
    return service;
  };

  for (const row of data) {
    const service = ensureService(row.serverServiceName);

    if (row.isNodeLevel) {
      // Rolled-up totals across all callers for this service.
      service.incomingRequests = statsFromRow(row);
    } else if (row.clientServiceName) {
      // Per-caller (edge) stats. Ensure the caller exists as a node too.
      ensureService(row.clientServiceName);
      service.incomingRequestsByClient.set(
        row.clientServiceName,
        statsFromRow(row),
      );
    }
    // Edge-level rows with no client service come from uninstrumented callers;
    // they're already included in the node-level totals, so no edge is drawn.
  }

  // Roll each edge's volume up to its caller's outgoing total.
  for (const service of services.values()) {
    for (const [clientName, stats] of service.incomingRequestsByClient) {
      const client = services.get(clientName);
      if (client) {
        client.outgoingRequests += stats.totalRequests;
      }
    }
  }

  return services;
}

export default function useServiceMap({
  source,
  dateRange,
  traceId,
  samplingFactor,
  where,
  whereLanguage,
  serviceNames,
}: {
  source: TTraceSource;
  dateRange: [Date, Date];
  traceId?: string;
  samplingFactor: number;
  where?: string;
  whereLanguage?: 'sql' | 'lucene';
  serviceNames?: string[];
}) {
  const client = useClickhouseClient();
  const metadata = useMetadataWithSettings();

  return useQuery({
    queryKey: [
      'serviceMapData',
      traceId,
      source,
      dateRange,
      samplingFactor,
      where,
      whereLanguage,
      serviceNames,
    ],
    queryFn: async ({ signal }) => {
      const query = await getServiceMapQuery({
        source,
        dateRange,
        traceId,
        metadata,
        samplingFactor,
        where,
        whereLanguage,
        serviceNames,
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
        .then(res => res.json<Record<string, unknown>>())
        .then(data =>
          data.data.map((row: Record<string, unknown>) => {
            // quantiles(...) returns a [p50, p95, p99] array; absent when the
            // source has no duration expression.
            const quantiles = Array.isArray(row.quantiles)
              ? (row.quantiles as unknown[])
              : undefined;
            return {
              serverServiceName: row.serverServiceName as string,
              // serviceName is a non-nullable LowCardinality(String), so
              // rolled-up node-level rows and unmatched LEFT JOINs come back as
              // '' rather than null — normalize those to undefined (no edge).
              clientServiceName: (row.clientServiceName as string) || undefined,
              isNodeLevel: Number(row.isNodeLevel) === 1,
              requestCount: Number.parseInt(row.requestCount as string, 10),
              errorCount: Number.parseInt(row.errorCount as string, 10),
              p50: quantiles ? Number(quantiles[0]) : undefined,
              p95: quantiles ? Number(quantiles[1]) : undefined,
              p99: quantiles ? Number(quantiles[2]) : undefined,
            };
          }),
        );

      return aggregateServiceMapData(data);
    },
    // Prevent refetching and updating the map layout
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
