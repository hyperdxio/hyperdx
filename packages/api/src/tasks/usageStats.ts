import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { ROOT_CONTEXT } from '@opentelemetry/api';
import { type AnyValueMap, SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import {
  defaultResource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import ms from 'ms';
import os from 'os';

import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import Connection from '@/models/connection';
import { Source, SourceDocument } from '@/models/source';
import Team from '@/models/team';
import User from '@/models/user';

const USAGE_STATS_SERVICE_NAME = 'hyperdx-oss-usage-stats';

// A provider of its own, not the global one: usage stats go to HyperDX with
// their own key and never to the operator's collector. Created on the first
// report, which api-app.ts gates on USAGE_STATS_ENABLED && !IS_CI, so
// importing this module sets nothing up.
let usageStatsProvider: LoggerProvider | null = null;
function getUsageStatsProvider(): LoggerProvider {
  if (!usageStatsProvider) {
    usageStatsProvider = new LoggerProvider({
      resource: defaultResource().merge(
        resourceFromAttributes({ 'service.name': USAGE_STATS_SERVICE_NAME }),
      ),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            // An explicit url wins over the OTEL_EXPORTER_OTLP_*ENDPOINT
            // variables.
            url: 'https://in-otel.hyperdx.io/v1/logs',
            // The exporter merges the OTEL_EXPORTER_OTLP_*HEADERS variables
            // into these, as the old SDK did. Explicit headers are applied
            // last, so this replaces one authorization entry from them, such
            // as the self-telemetry key, whatever its case.
            headers: {
              authorization: '3f26ffad-14cf-4fb7-9dc9-e64fa0b84ee0', // hyperdx usage stats service api key
            },
            // Without agent options the exporter builds its agent from the
            // OTEL_EXPORTER_OTLP_* certificate variables, which are meant for
            // the operator's collector.
            httpAgentOptions: { keepAlive: true },
          }),
        }),
      ],
    });
  }
  return usageStatsProvider;
}

export async function sendUsageStats(fields: AnyValueMap): Promise<void> {
  const provider = getUsageStatsProvider();
  const time = Date.now();
  // The pino records this replaced went through JSON, which turned NaN (from
  // parseInt on a null ClickHouse value) into null and dropped undefined
  // fields. The OTLP JSON encoder writes NaN as a null doubleValue instead,
  // which the collector rejects along with the whole report.
  const jsonFields: AnyValueMap = JSON.parse(JSON.stringify(fields));
  // The scope name of the pino records this replaced.
  provider.getLogger('node-logger').emit({
    body: 'track-hyperdx-oss-usage-stats',
    severityNumber: SeverityNumber.INFO,
    severityText: 'info',
    timestamp: time,
    // HyperDX never sees this deployment's traces, so do not link to them.
    context: ROOT_CONTEXT,
    // The pino records this replaced carried time, pid and hostname.
    attributes: {
      ...jsonFields,
      time,
      pid: process.pid,
      hostname: os.hostname(),
    },
  });
  await provider.forceFlush();
}

function extractTableNames(source: SourceDocument): string[] {
  const tables: string[] = [];
  if (source.kind === SourceKind.Metric) {
    // Cast to TMetricSource to access metricTables after kind narrowing
    const metricSource = source;
    for (const key of Object.values(MetricsDataType)) {
      const metricTable = metricSource.metricTables?.[key];
      if (!metricTable) continue;
      tables.push(metricTable);
    }
  } else {
    tables.push(source.from.tableName);
  }
  return tables;
}

const getClickhouseTableSize = async () => {
  // fetch mongo data
  const connections = await Connection.find();
  const sources = await Source.find();

  // build map for each db instance
  const distributedTableMap = new Map<string, string[]>();
  for (const source of sources) {
    const key = `${source.connection.toString()},${source.from.databaseName}`;
    if (distributedTableMap.has(key)) {
      distributedTableMap.get(key)?.push(...extractTableNames(source));
    } else {
      distributedTableMap.set(key, extractTableNames(source));
    }
  }

  // fetch usage data
  const results: any[] = [];
  for (const [key, tables] of distributedTableMap) {
    const [connectionId, dbName] = key.split(',');
    const tableListString = tables
      .map((_, idx) => `table = {table${idx}: String}`)
      .join(' OR ');
    const query_params = tables.reduce(
      (acc, table, idx) => {
        acc[`table${idx}`] = table;
        return acc;
      },
      {} as { [key: string]: string },
    );
    query_params.dbName = dbName;

    // find connection
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) continue;

    // query clickhouse
    try {
      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
        // This client is only used by this job.
        attribution: { surface: 'api', label: 'usage-stats' },
      });
      const _rows = await clickhouseClient.query({
        query: `
        SELECT
            table,
            sum(bytes) AS size,
            sum(rows) AS rows,
            min(min_time) AS min_time,
            max(max_time) AS max_time,
            max(modification_time) AS latestModification,
            toUInt32((max_time - min_time) / 86400) AS days,
            size / ((max_time - min_time) / 86400) AS avgDaySize
        FROM system.parts
        WHERE active
        AND database = {dbName: String}
        AND (${tableListString})
        GROUP BY table
        ORDER BY rows DESC
      `,
        format: 'JSON',
        query_params,
      });
      const res = await _rows.json<ResponseJSON<any>>();
      results.push(...res.data);
    } catch {
      // ignore
    }
  }
  return results;
};

async function getUsageStats() {
  try {
    const nowInMs = Date.now();
    const [userCounts, team, chTables] = await Promise.all([
      User.countDocuments(),
      Team.find(
        {},
        {
          _id: 1,
        },
      ).limit(1),
      getClickhouseTableSize(),
    ]);
    const clusterId = team[0]?._id.toString();
    await sendUsageStats({
      clusterId,
      version: config.CODE_VERSION,
      userCounts,
      os: {
        arch: os.arch(),
        freemem: os.freemem(),
        uptime: os.uptime(),
      },
      chStats: {
        tables: chTables.reduce(
          (acc, curr) => ({
            ...acc,
            [curr.table]: {
              avgDaySize: parseInt(curr.avgDaySize),
              days: parseInt(curr.days),
              lastModified: new Date(curr.latestModification).getTime(),
              maxTime: new Date(curr.max_time).getTime(),
              minTime: new Date(curr.min_time).getTime(),
              rows: parseInt(curr.rows),
              size: parseInt(curr.size),
            },
          }),
          {},
        ),
        rows: chTables.reduce((acc, curr) => acc + parseInt(curr.rows), 0),
        size: chTables.reduce((acc, curr) => acc + parseInt(curr.size), 0),
      },
      timestamp: nowInMs,
    });
  } catch {
    // ignore
  }
}

export default function () {
  void getUsageStats();
  setInterval(() => {
    void getUsageStats();
  }, ms('4h'));
}
