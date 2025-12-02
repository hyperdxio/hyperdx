import { createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { format } from 'date-fns';
import { z } from 'zod';
import ms from 'ms';

import * as config from '@/config';
import type { ObjectId } from '@/models';
import SLO, { ISLO, SLOMetricType, SLOSourceTable } from '@/models/slo';
import logger from '@/utils/logger';

export type SLOInput = {
  serviceName: string;
  sloName: string;
  metricType: SLOMetricType;
  targetValue: number;
  timeWindow: string;
  sourceTable: SLOSourceTable;
  numeratorQuery?: string;
  denominatorQuery?: string;
  filter?: string;
  goodCondition?: string;
  alertThreshold?: number;
};

// Inject time filter into a raw query string
export function injectTimeFilter(
  query: string,
  startTime: Date,
  endTime: Date,
): string {
  // Simple heuristic: if WHERE exists, append AND. Otherwise append WHERE.
  // This assumes the query is a simple SELECT ... FROM ... [WHERE ...]
  // A robust parser would be better, but for now we rely on simple injection.
  const timeFilter = `Timestamp >= '${startTime.toISOString().slice(0, 19).replace('T', ' ')}' AND Timestamp < '${endTime.toISOString().slice(0, 19).replace('T', ' ')}'`;

  if (/\bwhere\b/i.test(query)) {
    return `${query} AND ${timeFilter}`;
  }
  return `${query} WHERE ${timeFilter}`;
}

// Backfill aggregates for a new/updated SLO
async function backfillSLOAggregates(slo: ISLO): Promise<void> {
  const client = createNativeClient({
    url: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
    request_timeout: ms('5m'), // Allow longer timeout for backfill
  });

  const windowMs = ms(slo.timeWindow);
  if (!windowMs) return;

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - windowMs);

  // We'll aggregate by minute for the backfill period
  // NOTE: This backfill query is "heavy" as it scans the full window.
  // Ideally we would chunk this, but for simplicity we run it once.

  // Construct queries with time range (only used for Raw SQL mode)
  const numQuery = slo.numeratorQuery
    ? injectTimeFilter(slo.numeratorQuery, startTime, endTime)
    : '';
  const denQuery = slo.denominatorQuery
    ? injectTimeFilter(slo.denominatorQuery, startTime, endTime)
    : '';

  // We need to group by minute.
  // Since we can't easily rewrite the user's RAW query to add GROUP BY if it's complex,
  // we will use a slightly different approach:
  // We will assume the user's query returns a 'count' column.
  // We'll wrap it: SELECT toStartOfMinute(Timestamp) as ts, sum(count) ... GROUP BY ts
  // BUT the user's query might already be an aggregation (count()).
  // IF the user's query is "SELECT count() as count ...", we can't just wrap it easily to get per-minute buckets
  // without modifying the inner query to include Timestamp in select.

  // Builder Mode is easy. Raw SQL is hard to backfill efficiently with per-minute granularity without parsing.
  // COMPROMISE: For Raw SQL backfill, we might just insert a SINGLE aggregate row for the whole window
  // to get the initial status correct, OR we accept that we only strictly support proper backfill for Builder Mode.

  // Let's support Builder Mode backfill properly.
  if (slo.filter && slo.goodCondition) {
    const backfillQuery = `
      INSERT INTO default.slo_aggregates (slo_id, timestamp, numerator_count, denominator_count)
      SELECT
        '${slo.id}' as slo_id,
        toStartOfMinute(Timestamp) as timestamp,
        countIf(${slo.goodCondition}) as numerator_count,
        count() as denominator_count
      FROM default.${slo.sourceTable}
      WHERE ${slo.filter} AND Timestamp >= '${startTime.toISOString().slice(0, 19).replace('T', ' ')}'
      GROUP BY timestamp
    `;

    await client.command({ query: backfillQuery });
  } else {
    // Fallback for Raw SQL:
    // We can't easily backfill per-minute history without parsing SQL.
    // We will skip backfill for Raw SQL or try a "best effort" single bucket?
    // A single bucket at "now" with the total count would mess up the burn rate chart (spike).
    // Let's skip backfill for Raw SQL and let it accumulate from now.
    logger.warn(
      { sloId: slo.id },
      'Skipping backfill for Raw SQL SLO (not supported)',
    );
  }
}

// Validate ClickHouse queries by running EXPLAIN on them
async function validateClickHouseQueries(
  numeratorQuery: string,
  denominatorQuery: string,
): Promise<void> {
  const clickhouseClient = createNativeClient({
    url: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
    request_timeout: ms('30s'),
  });

  try {
    // Validate numerator query
    await clickhouseClient.query({
      query: `EXPLAIN ${numeratorQuery}`,
      format: 'JSON',
    });

    // Validate denominator query
    await clickhouseClient.query({
      query: `EXPLAIN ${denominatorQuery}`,
      format: 'JSON',
    });
  } catch (error: any) {
    logger.error(
      { error, numeratorQuery, denominatorQuery },
      'Failed to validate ClickHouse queries',
    );
    throw new Error(
      `Invalid ClickHouse query: ${error.message || 'Unknown error'}`,
    );
  }
}

export async function createSLO(
  teamId: ObjectId,
  sloInput: SLOInput,
  userId?: ObjectId,
): Promise<ISLO> {
  // Generate queries if structured input is provided
  if (sloInput.filter && sloInput.goodCondition) {
    sloInput.denominatorQuery = `SELECT count() as count FROM default.${sloInput.sourceTable} WHERE ${sloInput.filter}`;
    sloInput.numeratorQuery = `SELECT count() as count FROM default.${sloInput.sourceTable} WHERE ${sloInput.filter} AND (${sloInput.goodCondition})`;
  }

  if (!sloInput.numeratorQuery || !sloInput.denominatorQuery) {
    throw new Error('Numerator and Denominator queries are required');
  }

  // Validate queries
  await validateClickHouseQueries(
    sloInput.numeratorQuery,
    sloInput.denominatorQuery,
  );

  // Check for duplicate SLO
  const existingSLO = await SLO.findOne({
    team: teamId,
    serviceName: sloInput.serviceName,
    sloName: sloInput.sloName,
  });

  if (existingSLO) {
    throw new Error(
      `SLO with name "${sloInput.sloName}" already exists for service "${sloInput.serviceName}"`,
    );
  }

  const newSLO = await new SLO({
    ...sloInput,
    team: teamId,
    createdBy: userId,
    lastAggregatedAt: new Date(), // Start aggregating from now
  }).save();

  // Trigger backfill asynchronously
  backfillSLOAggregates(newSLO).catch(err => {
    logger.error(
      { error: err, sloId: newSLO._id },
      'Failed to backfill SLO aggregates',
    );
  });

  // Optionally sync to ClickHouse slo_definitions table for fast lookups
  // This is optional since we can query MongoDB, but it helps with performance
  // try {
  //   const clickhouseClient = createNativeClient({
  //     url: config.CLICKHOUSE_HOST,
  //     username: config.CLICKHOUSE_USER,
  //     password: config.CLICKHOUSE_PASSWORD,
  //     request_timeout: ms('30s'),
  //   });

  //   await clickhouseClient.insert({
  //     table: 'default.slo_definitions',
  //     values: [
  //       {
  //         id: newSLO._id.toString(),
  //         service_name: sloInput.serviceName,
  //         slo_name: sloInput.sloName,
  //         metric_type: sloInput.metricType,
  //         target_value: sloInput.targetValue,
  //         time_window: sloInput.timeWindow,
  //         source_table: sloInput.sourceTable,
  //         numerator_query: sloInput.numeratorQuery,
  //         denominator_query: sloInput.denominatorQuery,
  //         alert_threshold: sloInput.alertThreshold ?? 0,
  //         created_at: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
  //         updated_at: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
  //       },
  //     ],
  //     format: 'JSONEachRow',
  //   });
  // } catch (error: any) {
  //   logger.warn(
  //     { error, sloId: newSLO._id },
  //     'Failed to sync SLO definition to ClickHouse, continuing anyway',
  //   );
  //   // Don't fail the request if ClickHouse sync fails
  // }

  return newSLO;
}

export async function getSLOs(teamId: ObjectId): Promise<ISLO[]> {
  return SLO.find({ team: teamId }).sort({ createdAt: -1 });
}

export async function getSLO(
  sloId: string,
  teamId: ObjectId,
): Promise<ISLO | null> {
  return SLO.findOne({ _id: sloId, team: teamId });
}

export async function updateSLO(
  sloId: string,
  teamId: ObjectId,
  updates: Partial<SLOInput>,
  userId?: ObjectId,
): Promise<ISLO | null> {
  const slo = await getSLO(sloId, teamId);
  if (!slo) {
    throw new Error('SLO not found');
  }

  // If queries are being updated, validate them
  if (updates.filter && updates.goodCondition) {
    const sourceTable = updates.sourceTable || slo.sourceTable;
    updates.denominatorQuery = `SELECT count() as count FROM default.${sourceTable} WHERE ${updates.filter}`;
    updates.numeratorQuery = `SELECT count() as count FROM default.${sourceTable} WHERE ${updates.filter} AND (${updates.goodCondition})`;
  }

  if (updates.numeratorQuery || updates.denominatorQuery) {
    const numQuery = updates.numeratorQuery || slo.numeratorQuery || '';
    const denQuery = updates.denominatorQuery || slo.denominatorQuery || '';
    if (numQuery && denQuery) {
      await validateClickHouseQueries(numQuery, denQuery);
    }
  }

  // Check for duplicate if serviceName or sloName is being updated
  if (updates.serviceName || updates.sloName) {
    const existingSLO = await SLO.findOne({
      team: teamId,
      serviceName: updates.serviceName || slo.serviceName,
      sloName: updates.sloName || slo.sloName,
      _id: { $ne: sloId },
    });

    if (existingSLO) {
      throw new Error(
        `SLO with name "${updates.sloName || slo.sloName}" already exists for service "${updates.serviceName || slo.serviceName}"`,
      );
    }
  }

  const updatedSLO = await SLO.findOneAndUpdate(
    { _id: sloId, team: teamId },
    { ...updates, updatedAt: new Date() },
    { new: true },
  );

  // If queries or source table changed, trigger backfill?
  // We should probably clear old aggregates and re-backfill if the definition changed significantly.
  // For simplicity, we'll just let it drift or maybe backfill if queries changed.
  if (
    updatedSLO &&
    (updates.numeratorQuery ||
      updates.denominatorQuery ||
      updates.filter ||
      updates.sourceTable)
  ) {
    // Clear old aggregates for this SLO
    try {
      const client = createNativeClient({
        url: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
        request_timeout: ms('30s'),
      });
      // ClickHouse DELETE is async and lightweight
      await client.command({
        query: `ALTER TABLE default.slo_aggregates DELETE WHERE slo_id = '${updatedSLO._id}'`,
      });
      // Re-backfill
      backfillSLOAggregates(updatedSLO).catch(err => {
        logger.error(
          { error: err, sloId: updatedSLO._id },
          'Failed to re-backfill SLO aggregates',
        );
      });
    } catch (e) {
      logger.error({ error: e, sloId }, 'Failed to clear old aggregates');
    }
  }

  // Sync to ClickHouse if updated
  if (updatedSLO) {
    try {
      const clickhouseClient = createNativeClient({
        url: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
        request_timeout: ms('30s'),
      });

      // Delete old record and insert new one (ClickHouse doesn't support UPDATE well)
      await clickhouseClient.command({
        query: `ALTER TABLE default.slo_definitions DELETE WHERE id = {id: String}`,
        query_params: {
          id: updatedSLO._id.toString(),
        },
      });

      await clickhouseClient.insert({
        table: 'default.slo_definitions',
        values: [
          {
            id: updatedSLO._id.toString(),
            service_name: updatedSLO.serviceName,
            slo_name: updatedSLO.sloName,
            metric_type: updatedSLO.metricType,
            target_value: updatedSLO.targetValue,
            time_window: updatedSLO.timeWindow,
            source_table: updatedSLO.sourceTable,
            numerator_query: updatedSLO.numeratorQuery,
            denominator_query: updatedSLO.denominatorQuery,
            alert_threshold: updatedSLO.alertThreshold ?? 0,
            created_at: format(
              updatedSLO.createdAt || new Date(),
              'yyyy-MM-dd HH:mm:ss',
            ),
            updated_at: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
          },
        ],
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      logger.warn(
        { error, sloId: updatedSLO._id },
        'Failed to sync SLO update to ClickHouse, continuing anyway',
      );
    }
  }

  return updatedSLO;
}

export async function deleteSLO(
  sloId: string,
  teamId: ObjectId,
): Promise<void> {
  const slo = await getSLO(sloId, teamId);
  if (!slo) {
    throw new Error('SLO not found');
  }

  await SLO.findOneAndDelete({ _id: sloId, team: teamId });

  // Remove from ClickHouse
  try {
    const clickhouseClient = createNativeClient({
      url: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
      request_timeout: ms('30s'),
    });

    await clickhouseClient.command({
      query: `ALTER TABLE default.slo_definitions DELETE WHERE id = {id: String}`,
      query_params: {
        id: sloId,
      },
    });

    // Also cleanup aggregates
    await clickhouseClient.command({
      query: `ALTER TABLE default.slo_aggregates DELETE WHERE slo_id = {id: String}`,
      query_params: {
        id: sloId,
      },
    });
  } catch (error: any) {
    logger.warn(
      { error, sloId },
      'Failed to delete SLO from ClickHouse, continuing anyway',
    );
  }
}

export async function getSLOBubbleUp(
  sloId: string,
  teamId: ObjectId,
  timeStart: Date,
  timeEnd: Date,
): Promise<any> {
  const slo = await getSLO(sloId, teamId);
  if (!slo) {
    throw new Error('SLO not found');
  }

  if (!slo.filter || !slo.goodCondition) {
    throw new Error(
      'SLO does not support BubbleUp (missing filter/goodCondition)',
    );
  }

  const client = createNativeClient({
    url: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
    request_timeout: ms('60s'),
  });

  const startTimeStr = timeStart.toISOString().slice(0, 19).replace('T', ' ');
  const endTimeStr = timeEnd.toISOString().slice(0, 19).replace('T', ' ');

  const baseFilter = `${slo.filter} AND Timestamp >= '${startTimeStr}' AND Timestamp <= '${endTimeStr}'`;
  const badFilter = `${baseFilter} AND NOT (${slo.goodCondition})`;

  // Determine attribute map name based on source table
  const isTraces = slo.sourceTable === SLOSourceTable.TRACES;
  const attributesMap = isTraces ? 'SpanAttributes' : 'LogAttributes';

  // 2. Find top attributes in bad set
  const topAttributesQuery = `
    SELECT
      arrayJoin(mapKeys(${attributesMap})) as key,
      count() as count
    FROM default.${slo.sourceTable}
    WHERE ${badFilter}
    GROUP BY key
    ORDER BY count DESC
    LIMIT 5
  `;

  let topKeys: string[] = [];
  try {
    const topAttributesRes = await client.query({
      query: topAttributesQuery,
      format: 'JSON',
    });
    const topAttributesData = await topAttributesRes.json<{
      data: { key: string; count: number }[];
    }>();
    topKeys = topAttributesData.data.map(d => d.key);
  } catch (e) {
    logger.error(
      { error: e, sloId },
      'Failed to fetch top attributes for BubbleUp',
    );
    // Fallback to empty keys if query fails (e.g. syntax error in filter)
  }

  // Different candidate keys based on source table
  const candidateKeys = isTraces
    ? ['ServiceName', 'SpanName', 'StatusCode', ...topKeys]
    : ['ServiceName', 'SeverityText', ...topKeys];

  const uniqueKeys = Array.from(new Set(candidateKeys));
  const results: Array<{
    attribute: string;
    values: Array<{
      value: string;
      badCount: number;
      goodCount: number;
    }>;
  }> = [];

  for (const key of uniqueKeys) {
    let keyExpr = '';
    let whereClause = '';

    // Standard columns that exist in both tables
    const standardColumns = ['ServiceName'];
    // Table-specific columns
    const logsColumns = ['SeverityText', 'SeverityNumber'];
    const tracesColumns = ['SpanName', 'StatusCode', 'Duration'];

    if (
      standardColumns.includes(key) ||
      (isTraces && tracesColumns.includes(key)) ||
      (!isTraces && logsColumns.includes(key))
    ) {
      keyExpr = key;
      whereClause = baseFilter; // These columns exist in the table
    } else {
      keyExpr = `${attributesMap}['${key}']`;
      whereClause = `${baseFilter} AND mapContains(${attributesMap}, '${key}')`;
    }

    const query = `
      SELECT
        ${keyExpr} as value,
        countIf(NOT (${slo.goodCondition})) as bad_count,
        countIf(${slo.goodCondition}) as good_count
      FROM default.${slo.sourceTable}
      WHERE ${whereClause}
      GROUP BY value
      HAVING bad_count > 0
      ORDER BY bad_count DESC
      LIMIT 10
    `;

    try {
      const res = await client.query({ query, format: 'JSON' });
      const data = await res.json<{
        data: { value: string; bad_count: number; good_count: number }[];
      }>();

      if (data.data && data.data.length > 0) {
        results.push({
          attribute: key,
          values: data.data.map(row => ({
            value: row.value,
            badCount: Number(row.bad_count),
            goodCount: Number(row.good_count),
          })),
        });
      }
    } catch (e) {
      logger.error(
        { error: e, key, sloId },
        'Failed to query BubbleUp attribute',
      );
    }
  }

  return results;
}
