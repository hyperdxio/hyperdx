import * as fns from 'date-fns';
import SqlString from 'sqlstring';
import _ from 'lodash';
import ms from 'ms';
import opentelemetry from '@opentelemetry/api';
import {
  SettingsMap,
} from '@clickhouse/client';

import { client } from './client';
import logger from '@/utils/logger';
import {
  LogsPropertyTypeMappingsModel,
  MetricsPropertyTypeMappingsModel,
} from './propertyTypeMappingsModel';
import {
  SQLSerializer,
  buildSearchColumnName,
  buildSearchColumnName_OLD,
  buildSearchQueryWhereCondition,
  isCustomColumn,
  msToBigIntNs,
} from './searchQueryParser';

import type { ResponseJSON, ResultSet } from '@clickhouse/client';

// reexporting things that used to be in this file
export { getMetricsTags } from './queries/metricTags';
export { getSessions } from './queries/sessions';
export { bulkInsertRrwebEvents, bulkInsertTeamLogStream, bulkInsertTeamMetricStream } from './queries/bulkInsert';
export { getChartHistogram } from './queries/chartHistogram';

// TODO this is only needed until tests are migrated!
export { clientInsertWithRetries } from './queries/bulkInsert';

const tracer = opentelemetry.trace.getTracer(__filename);

export type SortOrder = 'asc' | 'desc' | null;

export type MetricChartConfig = {
  aggFn: AggFn;
  dataType: MetricsDataType;
  endTime: number; // unix in ms,
  granularity: Granularity;
  groupBy?: string;
  name: string;
  q: string;
  startTime: number; // unix in ms
  teamId: string;
}

export enum MetricsDataType {
  Gauge = 'Gauge',
  Histogram = 'Histogram',
  Sum = 'Sum',
}

export enum AggFn {
  Avg = 'avg',
  AvgRate = 'avg_rate',
  Count = 'count',
  CountDistinct = 'count_distinct',
  Max = 'max',
  MaxRate = 'max_rate',
  Min = 'min',
  MinRate = 'min_rate',
  P50 = 'p50',
  P50Rate = 'p50_rate',
  P90 = 'p90',
  P90Rate = 'p90_rate',
  P95 = 'p95',
  P95Rate = 'p95_rate',
  P99 = 'p99',
  P99Rate = 'p99_rate',
  Sum = 'sum',
  SumRate = 'sum_rate',
}

export enum Granularity {
  ThirtySecond = '30 second',
  OneMinute = '1 minute',
  FiveMinute = '5 minute',
  TenMinute = '10 minute',
  FifteenMinute = '15 minute',
  ThirtyMinute = '30 minute',
  OneHour = '1 hour',
  TwoHour = '2 hour',
  SixHour = '6 hour',
  TwelveHour = '12 hour',
  OneDay = '1 day',
  TwoDay = '2 day',
  SevenDay = '7 day',
  ThirtyDay = '30 day',
}

export enum TableName {
  LogStream = 'log_stream',
  Metric = 'metric_stream',
  Rrweb = 'rrweb',
}

export const getLogStreamTableName = (
  version: number | undefined | null,
  teamId: string,
) => `default.${TableName.LogStream}`;

export const buildTeamLogStreamWhereCondition = (
  version: number | undefined | null,
  teamId: string,
) => SqlString.raw('(1 = 1)');

export const buildLogStreamAdditionalFilters = (
  version: number | undefined | null,
  teamId: string,
) => SettingsMap.from({});

// TODO: support since, until
export const fetchMetricsPropertyTypeMappings =
  (intervalSecs: number) =>
  async (tableVersion: number | undefined, teamId: string) => {
    const tableName = `default.${TableName.Metric}`;
    const fromClause = [tableName, intervalSecs];
    const query = SqlString.format(
      `
    SELECT groupUniqArrayArray(mapKeys(_string_attributes)) as strings
    FROM ??
    WHERE fromUnixTimestamp64Nano(_timestamp_sort_key) > now() - toIntervalSecond(?)
  `,
      fromClause,
    );
    const ts = Date.now();
    const rows = await client.query({
      query,
      format: 'JSON',
    });
    const result = await rows.json<ResponseJSON<Record<string, any[]>>>();
    logger.info({
      message: 'fetchMetricsPropertyTypeMappings',
      query,
      took: Date.now() - ts,
    });
    return result;
  };

// since, until -> unix in ms
// TODO: what if since is like 0 or the difference is too big?
export const fetchLogsPropertyTypeMappings =
  (since: number, until: number) =>
  async (tableVersion: number | undefined, teamId: string) => {
    const tableName = getLogStreamTableName(tableVersion, teamId);
    const query = SqlString.format(
      `
    SELECT 
      groupUniqArrayArray(mapKeys(_string_attributes)) as strings,
      groupUniqArrayArray(mapKeys(_number_attributes)) as numbers,
      groupUniqArrayArray(mapKeys(_bool_attributes)) as bools
    FROM ??
    WHERE ?
    AND _timestamp_sort_key >= ?
    AND _timestamp_sort_key <= ?
  `,
      [
        tableName,
        buildTeamLogStreamWhereCondition(tableVersion, teamId),
        msToBigIntNs(since),
        msToBigIntNs(until),
      ],
    );
    const ts = Date.now();
    const rows = await client.query({
      query,
      format: 'JSON',
      clickhouse_settings: {
        additional_table_filters: buildLogStreamAdditionalFilters(
          tableVersion,
          teamId,
        ),
      },
    });
    const result = await rows.json<ResponseJSON<Record<string, any[]>>>();
    logger.info({
      message: 'fetchLogsPropertyTypeMappings',
      query,
      took: Date.now() - ts,
    });
    return result;
  };

// ******************************************************
// ****************** Helpers ***************************
// ******************************************************
export const msRangeToHistogramInterval = (msRange: number, total: number) => {
  const diffSeconds = Math.floor(msRange / 1000);
  const granularitySeconds = Math.ceil(diffSeconds / total);

  if (granularitySeconds <= 1) {
    return '1 second';
  } else if (granularitySeconds <= 2) {
    return '2 second';
  } else if (granularitySeconds <= 5) {
    return '5 second';
  } else if (granularitySeconds <= 10) {
    return '10 second';
  } else if (granularitySeconds <= 20) {
    return '20 second';
  } else if (granularitySeconds <= 30) {
    return '30 second';
  } else if (granularitySeconds <= 60) {
    return '1 minute';
  } else if (granularitySeconds <= 5 * 60) {
    return '5 minute';
  } else if (granularitySeconds <= 10 * 60) {
    return '10 minute';
  } else if (granularitySeconds <= 15 * 60) {
    return '15 minute';
  } else if (granularitySeconds <= 30 * 60) {
    return '30 minute';
  } else if (granularitySeconds <= 3600) {
    return '1 hour';
  } else if (granularitySeconds <= 2 * 3600) {
    return '2 hour';
  } else if (granularitySeconds <= 6 * 3600) {
    return '6 hour';
  } else if (granularitySeconds <= 12 * 3600) {
    return '12 hour';
  } else if (granularitySeconds <= 24 * 3600) {
    return '1 day';
  } else if (granularitySeconds <= 2 * 24 * 3600) {
    return '2 day';
  } else if (granularitySeconds <= 7 * 24 * 3600) {
    return '7 day';
  } else if (granularitySeconds <= 30 * 24 * 3600) {
    return '30 day';
  }

  return '30 day';
};

export const buildLogsPropertyTypeMappingsModel = async (
  tableVersion: number | undefined,
  teamId: string,
  since: number, // unix in ms
  until: number, // unix in ms
) => {
  const model = new LogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    fetchLogsPropertyTypeMappings(since, until),
  );
  await model.init();
  return model;
};

// TODO: separate by data_type ??
export const buildMetricsPropertyTypeMappingsModel = async (
  tableVersion: number | undefined,
  teamId: string,
) => {
  const model = new MetricsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    fetchMetricsPropertyTypeMappings(ms('28d') / 1000),
  );
  await model.init();
  return model;
};

// ******************************************************
export const getCHServerMetrics = async () => {
  const query = `
      SELECT metric, value
      FROM system.metrics
    `;
  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
  });
  const result = await rows.json<
    ResponseJSON<{ metric: string; value: string }>
  >();
  logger.info({
    message: 'getCHServerMetrics',
    query,
    took: Date.now() - ts,
  });
  return result.data
    .map(row => ({
      [`${row.metric}`]: parseInt(row.value),
    }))
    .reduce((result, obj) => {
      return { ...result, ...obj };
    }, {});
};

const isRateAggFn = (aggFn: AggFn) => {
  return (
    aggFn === AggFn.SumRate ||
    aggFn === AggFn.AvgRate ||
    aggFn === AggFn.MaxRate ||
    aggFn === AggFn.MinRate ||
    aggFn === AggFn.P50Rate ||
    aggFn === AggFn.P90Rate ||
    aggFn === AggFn.P95Rate ||
    aggFn === AggFn.P99Rate
  );
};

const buildMetricsChartSelectClause = async ({granularity, groupBy, dataType, aggFn}:{granularity:Granularity, groupBy?:string, dataType:MetricsDataType, aggFn:AggFn}):Promise<string[]> => {
  const isRate = isRateAggFn(aggFn);
  const selectClause:string[] = [];
  const bucket = SqlString.format(
    'toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ?)) AS ts_bucket',
    [granularity],
  )

  selectClause.push(bucket)
  if(groupBy) {
    const group = SqlString.format(`_string_attributes[?] AS group`, [groupBy])
    selectClause.push(group)
  } else {
    const group = 'name AS group';
    selectClause.push(group)
  }

  if (dataType === MetricsDataType.Gauge || dataType === MetricsDataType.Sum) {
    selectClause.push(
      aggFn === AggFn.Count
        ? 'COUNT(value) as data'
        : aggFn === AggFn.Sum
        ? `SUM(value) as data`
        : aggFn === AggFn.Avg
        ? `AVG(value) as data`
        : aggFn === AggFn.Max
        ? `MAX(value) as data`
        : aggFn === AggFn.Min
        ? `MIN(value) as data`
        : aggFn === AggFn.SumRate
        ? `SUM(rate) as data`
        : aggFn === AggFn.AvgRate
        ? `AVG(rate) as data`
        : aggFn === AggFn.MaxRate
        ? `MAX(rate) as data`
        : aggFn === AggFn.MinRate
        ? `MIN(rate) as data`
        : `quantile(${
            aggFn === AggFn.P50 || aggFn === AggFn.P50Rate
              ? '0.5'
              : aggFn === AggFn.P90 || aggFn === AggFn.P90Rate
              ? '0.90'
              : aggFn === AggFn.P95 || aggFn === AggFn.P95Rate
              ? '0.95'
              : '0.99'
          })(${isRate ? 'rate' : 'value'}) as data`,
    );
  } else {
    logger.error(`Unsupported data type: ${dataType}`);
  }

  return selectClause;
};

export const getMetricsChart = async ({
  aggFn,
  dataType,
  endTime,
  granularity,
  groupBy,
  name,
  q,
  startTime,
  teamId,
}: MetricChartConfig) => {
  const tableName = `default.${TableName.Metric}`;
  const propertyTypeMappingsModel = await buildMetricsPropertyTypeMappingsModel(
    undefined, // default version
    teamId,
  );
  const whereClause = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });
  const isRate = isRateAggFn(aggFn);
  const selectClause = await buildMetricsChartSelectClause({granularity, groupBy, dataType, aggFn});
  
  // used to sum/avg/percentile Sum metrics
  // max/min don't require pre-bucketing the Sum timeseries
  const sumMetricSource = SqlString.format(
    `
    SELECT
      toStartOfInterval(timestamp, INTERVAL ?) as timestamp,
      min(value) as value,
      _string_attributes,
      name
    FROM
      ??
    WHERE
      name = ?
      AND data_type = ?
      AND (?)
    GROUP BY
      name,
      _string_attributes,
      timestamp
    ORDER BY
      _string_attributes,
      timestamp ASC
  `.trim(),
    [granularity, tableName, name, dataType, SqlString.raw(whereClause)],
  );

  const rateMetricSource = SqlString.format(
    `
SELECT
  if(
    runningDifference(value) < 0
    OR neighbor(_string_attributes, -1, _string_attributes) != _string_attributes,
    nan,
    runningDifference(value)
  ) AS rate,
  timestamp,
  _string_attributes,
  name
FROM
  (
    ?
  )
`.trim(),
    [SqlString.raw(sumMetricSource)],
  );

  const gaugeMetricSource = SqlString.format(
    `
SELECT 
  timestamp,
  name,
  value,
  _string_attributes
FROM ??
WHERE name = ?
AND data_type = ?
AND (?)
ORDER BY _timestamp_sort_key ASC
`.trim(),
    [tableName, name, dataType, SqlString.raw(whereClause)],
  );

  const query = SqlString.format(
    `
      WITH metrics AS (?)
      SELECT ?
      FROM metrics
      GROUP BY group, ts_bucket
      ORDER BY ts_bucket ASC
      WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?
    `,
    [
      SqlString.raw(
        isRate
          ? rateMetricSource
          : // Max/Min aggs are the same for both Sum and Gauge metrics
          dataType === 'Sum' && aggFn != AggFn.Max && aggFn != AggFn.Min
          ? sumMetricSource
          : gaugeMetricSource,
      ),
      SqlString.raw(selectClause.join(',')),
      startTime / 1000,
      granularity,
      endTime / 1000,
      granularity,
      ms(granularity) / 1000,
    ],
  );

  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
  });
  const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
  logger.info({
    message: 'getMetricsChart',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export const getLogsChart = async ({
  aggFn,
  endTime,
  field,
  granularity,
  groupBy,
  maxNumGroups,
  propertyTypeMappingsModel,
  q,
  sortOrder,
  startTime,
  tableVersion,
  teamId,
}: {
  aggFn: AggFn;
  endTime: number; // unix in ms,
  field: string;
  granularity: string | undefined; // can be undefined in the number chart
  groupBy: string;
  maxNumGroups: number;
  propertyTypeMappingsModel: LogsPropertyTypeMappingsModel;
  q: string;
  sortOrder?: 'asc' | 'desc';
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  if (isRateAggFn(aggFn)) {
    throw new Error('Rate is not supported in logs chart');
  }

  const tableName = getLogStreamTableName(tableVersion, teamId);
  const whereClause = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });

  // WARNING: selectField can be null
  const selectField = buildSearchColumnName(
    propertyTypeMappingsModel.get(field),
    field,
  );

  const hasGroupBy = groupBy != '' && groupBy != null;
  const isCountFn = aggFn === AggFn.Count;
  const groupByField =
    hasGroupBy &&
    buildSearchColumnName(propertyTypeMappingsModel.get(groupBy), groupBy);

  const serializer = new SQLSerializer(propertyTypeMappingsModel);

  const selectClause = [
    isCountFn
      ? 'count() as data'
      : aggFn === AggFn.Sum
      ? `sum(${selectField}) as data`
      : aggFn === AggFn.Avg
      ? `avg(${selectField}) as data`
      : aggFn === AggFn.Max
      ? `max(${selectField}) as data`
      : aggFn === AggFn.Min
      ? `min(${selectField}) as data`
      : aggFn === AggFn.CountDistinct
      ? `count(distinct ${selectField}) as data`
      : `quantile(${
          aggFn === AggFn.P50
            ? '0.5'
            : aggFn === AggFn.P90
            ? '0.90'
            : aggFn === AggFn.P95
            ? '0.95'
            : '0.99'
        })(${selectField}) as data`,
    granularity != null
      ? `toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ${granularity})) as ts_bucket`
      : "'0' as ts_bucket",
    groupByField ? `${groupByField} as group` : `'${aggFn}' as group`, // FIXME: should we fallback to use aggFn as group
  ].join(',');

  const groupByClause = `ts_bucket ${groupByField ? `, ${groupByField}` : ''}`;

  const query = SqlString.format(
    `
      WITH raw_groups AS (
        SELECT ?
        FROM ??
        WHERE ? AND (?) ? ?
        GROUP BY ?
      ), groups AS (
        SELECT *, MAX(data) OVER (PARTITION BY group) as rank_order_by_value
        FROM raw_groups
      ), final AS (
        SELECT *, DENSE_RANK() OVER (ORDER BY rank_order_by_value DESC) as rank
        FROM groups
      )
      SELECT *
      FROM final
      WHERE rank <= ?
      ORDER BY ts_bucket ASC
      ${
        granularity != null
          ? `WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?`
          : ''
      }${
      sortOrder === 'asc' || sortOrder === 'desc' ? `, data ${sortOrder}` : ''
    }
    `,
    [
      SqlString.raw(selectClause),
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereClause),
      SqlString.raw(
        !isCountFn ? ` AND (${await serializer.isNotNull(field, false)})` : '',
      ),
      SqlString.raw(
        hasGroupBy
          ? ` AND (${await serializer.isNotNull(groupBy, false)})`
          : '',
      ),
      SqlString.raw(groupByClause),
      maxNumGroups,
      ...(granularity != null
        ? [
            startTime / 1000,
            granularity,
            endTime / 1000,
            granularity,
            ms(granularity) / 1000,
          ]
        : []),
    ],
  );

  return await tracer.startActiveSpan('clickhouse.getLogsChart', async span => {
    span.setAttribute('query', query);
    try {
      const ts = Date.now();
      const rows = await client.query({
        query,
        format: 'JSON',
        clickhouse_settings: {
          additional_table_filters: buildLogStreamAdditionalFilters(
            tableVersion,
            teamId,
          ),
        },
      });
      const result = await rows.json<
        ResponseJSON<{
          data: string;
          ts_bucket: number;
          group: string;
          rank: string;
          rank_order_by_value: string;
        }>
      >();
      logger.info({
        message: 'getChart',
        query,
        teamId,
        took: Date.now() - ts,
      });
      return result;
    } catch (e) {
      span.recordException(e as any);
      throw e;
    } finally {
      span.end();
    }
  });
};

export const getHistogram = async (
  tableVersion: number | undefined,
  teamId: string,
  q: string,
  startTime: number, // unix in ms
  endTime: number, // unix in ms,
) => {
  const msRange = endTime - startTime;
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTime,
    endTime,
  );
  const whereCondition = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });
  const interval = msRangeToHistogramInterval(msRange, 120);
  const query = SqlString.format(
    `
      SELECT
        toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ?)) as ts_bucket,
        if(multiSearchAny(severity_text, ['err', 'emerg', 'alert', 'crit', 'fatal']), 'error', 'info') as severity_group,
        count(*) as count
      FROM ??
      WHERE ? AND (?)
      GROUP BY ts_bucket, severity_group
      ORDER BY ts_bucket
      WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?
      LIMIT 1000
    `,
    [
      interval,
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereCondition),
      startTime / 1000,
      interval,
      endTime / 1000,
      interval,
      ms(interval) / 1000,
    ],
  );
  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildLogStreamAdditionalFilters(
        tableVersion,
        teamId,
      ),
    },
  });
  const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
  logger.info({
    message: 'getHistogram',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export const getLogById = async (
  tableVersion: number | undefined,
  teamId: string,
  sortKey: string,
  logId: string,
) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const query = SqlString.format(
    `
      SELECT
        id,
        _timestamp_sort_key AS sort_key,
        timestamp,
        observed_timestamp,
        end_timestamp,
        parent_span_id,
        trace_id,
        span_id,
        span_name,
        severity_number,
        severity_text,
        type,
        "string.names",
        "string.values",
        "number.names",
        "number.values",
        "bool.names",
        "bool.values",
        _source,
        _service,
        _host,
        _platform,
        _duration as duration,
        _hdx_body as body
      FROM ??
      WHERE ? AND _timestamp_sort_key = ? AND id = toUUID(?)
    `,
    [
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      sortKey,
      logId,
    ],
  );
  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildLogStreamAdditionalFilters(
        tableVersion,
        teamId,
      ),
    },
  });
  const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
  logger.info({
    message: 'getLogById',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export const checkAlert = async ({
  endTime,
  groupBy,
  q,
  startTime,
  tableVersion,
  teamId,
  windowSizeInMins,
}: {
  endTime: Date;
  groupBy?: string;
  q: string;
  startTime: Date;
  tableVersion: number | undefined;
  teamId: string;
  windowSizeInMins: number;
}) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const startTimeMs = fns.getTime(startTime);
  const endTimeMs = fns.getTime(endTime);

  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTimeMs,
    endTimeMs,
  );
  const whereCondition = await buildSearchQueryWhereCondition({
    endTime: endTimeMs,
    propertyTypeMappingsModel,
    query: groupBy ? `${q} ${groupBy}:*` : q,
    startTime: startTimeMs,
  });

  const interval = `${windowSizeInMins} minute`;

  // extract group-by prop type
  // FIXME: what if groupBy prop does not exist?
  let groupByPropType;
  if (groupBy) {
    const serializer = new SQLSerializer(propertyTypeMappingsModel);
    const { found, propertyType } = await serializer.getColumnForField(groupBy);
    if (!found) {
      throw new Error(`groupBy prop ${groupBy} does not exist`);
    }
    groupByPropType = propertyType;
  }

  const query = SqlString.format(
    `
      SELECT 
        ?
        count(*) as data,
        toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ?)) as ts_bucket
      FROM ??
      WHERE ? AND (?)
      GROUP BY ?
      ORDER BY ts_bucket
      WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?
    `,
    [
      SqlString.raw(
        groupBy
          ? `${buildSearchColumnName(groupByPropType, groupBy)} as group,`
          : '',
      ),
      interval,
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereCondition),
      SqlString.raw(
        groupBy
          ? `${buildSearchColumnName(groupByPropType, groupBy)}, ts_bucket`
          : 'ts_bucket',
      ),
      startTimeMs / 1000,
      interval,
      endTimeMs / 1000,
      interval,
      ms(interval) / 1000,
    ],
  );

  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildLogStreamAdditionalFilters(
        tableVersion,
        teamId,
      ),
    },
  });
  const result = await rows.json<
    ResponseJSON<{ data: string; group?: string; ts_bucket: number }>
  >();
  logger.info({
    message: 'checkAlert',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export type LogSearchRow = {
  timestamp: string;
  severity_text: string;
  body: string;
  _host: string;
  _source: string;
};

const buildLogQuery = async ({
  defaultFields = [
    'id',
    'timestamp',
    'severity_text',
    '_timestamp_sort_key AS sort_key',
    'type',
    '_hdx_body as body',
    '_duration as duration',
    '_service',
    '_host',
    '_platform',
  ],
  endTime,
  extraFields = [],
  limit,
  offset,
  order,
  q,
  startTime,
  tableVersion,
  teamId,
}: {
  defaultFields?: string[];
  endTime: number; // unix in ms
  extraFields?: string[];
  limit: number;
  offset: number;
  order: SortOrder;
  q: string;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  // Validate order
  if (!['asc', 'desc', null].includes(order)) {
    throw new Error(`Invalid order: ${order}`);
  }

  const tableName = getLogStreamTableName(tableVersion, teamId);
  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTime,
    endTime,
  );

  const whereCondition = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
    teamId,
  });

  const extraColumns = extraFields
    .map(field => {
      const fieldType = propertyTypeMappingsModel.get(field);
      const column = buildSearchColumnName(fieldType, field);
      // FIXME: sql injection ??
      return column ? `${column} as "${field}"` : null;
    })
    .filter(f => f);

  const columns = _.map([...defaultFields, ...extraColumns], SqlString.raw);
  const query = SqlString.format(
    `
      SELECT ?
      FROM ??
      WHERE ? AND (?)
      ?
      LIMIT ?, ?
    `,
    [
      columns,
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereCondition),
      SqlString.raw(
        order !== null ? `ORDER BY _timestamp_sort_key ${order}` : '',
      ),
      offset,
      limit,
    ],
  );

  return query;
};

export const getLogBatchGroupedByBody = async ({
  bodyMaxLength,
  endTime,
  interval,
  limit,
  q,
  sampleRate,
  startTime,
  tableVersion,
  teamId,
}: {
  bodyMaxLength: number;
  endTime: number; // unix in ms
  interval: ReturnType<typeof msRangeToHistogramInterval>;
  limit: number;
  q: string;
  sampleRate?: number;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTime,
    endTime,
  );

  const whereCondition = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });

  const query = SqlString.format(
    `
      SELECT
        COUNT(*) as lines_count,
        groupArray(toStartOfInterval(timestamp, INTERVAL ?)) as buckets,
        groupArray(fromUnixTimestamp64Nano(_timestamp_sort_key)) as timestamps,
        groupArray(id) as ids,
        groupArray(_timestamp_sort_key) AS sort_keys,
        severity_text as level,
        _service as service,
        substring(_hdx_body, 1, ?) as body
      FROM ??
      WHERE randUniform(0, 1) <= ?
      AND (?)
      AND (?)
      GROUP BY level, service, body
      ORDER BY lines_count DESC
      LIMIT ?
    `,
    [
      interval,
      bodyMaxLength,
      tableName,
      sampleRate ?? 1,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereCondition),
      limit,
    ],
  );

  type Response = ResponseJSON<{
    body: string;
    buckets: string[];
    ids: string[];
    sort_keys: string[];
    level: string;
    lines_count: string;
    service: string;
    timestamps: string[];
  }>;

  let result: Response;

  await tracer.startActiveSpan(
    'clickhouse.getLogBatchGroupedByBody',
    async span => {
      span.setAttribute('query', query);

      const rows = await client.query({
        query,
        format: 'JSON',
        clickhouse_settings: {
          additional_table_filters: buildLogStreamAdditionalFilters(
            tableVersion,
            teamId,
          ),
        },
      });
      result = await rows.json<Response>();
      span.setAttribute('results', result.data.length);
      span.end();
    },
  );

  // @ts-ignore
  return result;
};

export const getLogBatch = async ({
  endTime,
  extraFields = [],
  limit,
  offset,
  order,
  q,
  startTime,
  tableVersion,
  teamId,
}: {
  endTime: number; // unix in ms
  extraFields?: string[];
  limit: number;
  offset: number;
  order: SortOrder;
  q: string;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const query = await buildLogQuery({
    endTime,
    extraFields,
    limit,
    offset,
    order,
    q,
    startTime,
    tableVersion,
    teamId,
  });

  let result: ResponseJSON<{
    id: string;
    timestamp: string;
    severity_text: string;
    body: string;
    _host: string;
    _source: string;
  }>;
  await tracer.startActiveSpan('clickhouse.getLogBatch', async span => {
    span.setAttribute('query', query);

    const rows = await client.query({
      query,
      format: 'JSON',
      clickhouse_settings: {
        additional_table_filters: buildLogStreamAdditionalFilters(
          tableVersion,
          teamId,
        ),
      },
    });
    result = await rows.json<
      ResponseJSON<{
        id: string;
        timestamp: string;
        severity_text: string;
        body: string;
        _host: string;
        _source: string;
      }>
    >();
    span.setAttribute('results', result.data.length);
    span.end();
  });

  // @ts-ignore
  return result;
};

export const getRrwebEvents = async ({
  sessionId,
  startTime,
  endTime,
  limit,
  offset,
}: {
  sessionId: string;
  startTime: number; // unix in ms
  endTime: number; // unix in ms
  limit: number;
  offset: number;
}) => {
  const columns = [
    'body AS b',
    'type AS t',
    `${buildSearchColumnName_OLD('number', 'rr-web.chunk')} as ck`,
    `${buildSearchColumnName_OLD('number', 'rr-web.total-chunks')} as tcks`,
  ].map(SqlString.raw);

  const query = SqlString.format(
    `
      SELECT ?
      FROM default.rrweb
      WHERE session_id = ?
      AND _timestamp_sort_key >= ?
      AND _timestamp_sort_key < ?
      ORDER BY _timestamp_sort_key, ck ASC
      LIMIT ?, ?
    `,
    [
      columns,
      sessionId,
      msToBigIntNs(startTime),
      msToBigIntNs(endTime),
      offset,
      limit,
    ],
  );

  let resultSet: ResultSet;
  await tracer.startActiveSpan('clickhouse.getRrwebEvents', async span => {
    span.setAttribute('query', query);

    resultSet = await client.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        wait_end_of_query: 0,
        send_progress_in_http_headers: 0,
      } as any,
    });
    span.end();
  });

  // @ts-ignore
  return resultSet.stream();
};

export const getLogStream = async ({
  endTime,
  extraFields = [],
  limit,
  offset,
  order,
  q,
  startTime,
  tableVersion,
  teamId,
}: {
  endTime: number; // unix in ms
  extraFields?: string[];
  limit: number;
  offset: number;
  order: SortOrder;
  q: string;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const query = await buildLogQuery({
    endTime,
    extraFields,
    limit,
    offset,
    order,
    q,
    startTime,
    tableVersion,
    teamId,
  });

  logger.info({
    message: 'generated getLogStream Query',
    teamId,
    query,
    limit,
  });

  let resultSet: ResultSet;
  await tracer.startActiveSpan('clickhouse.getLogStream', async span => {
    span.setAttribute('query', query);
    span.setAttribute('search', q);
    span.setAttribute('teamId', teamId);
    try {
      resultSet = await client.query({
        query,
        format: 'JSONEachRow',
        clickhouse_settings: {
          additional_table_filters: buildLogStreamAdditionalFilters(
            tableVersion,
            teamId,
          ),
          send_progress_in_http_headers: 0,
          wait_end_of_query: 0,
        },
      });
    } catch (e: any) {
      span.recordException(e);

      throw e;
    } finally {
      span.end();
    }
  });

  // @ts-ignore
  return resultSet.stream();
};
