import { createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import ms from 'ms';

import * as config from '@/config';
import type { ObjectId } from '@/models';
import SLO, { ISLO, SLOStatus } from '@/models/slo';
import logger from '@/utils/logger';

export interface SLOStatusResult {
  slo: ISLO;
  achieved: number;
  target: number;
  errorBudgetRemaining: number;
  status: SLOStatus;
  numerator: number;
  denominator: number;
  windowStart: Date;
  windowEnd: Date;
  timestamp: Date;
}

/**
 * Calculate SLO status from measurements or compute on-demand
 */
export async function getSLOStatus(
  sloId: string,
  teamId: ObjectId,
): Promise<SLOStatusResult | null> {
  const slo = await SLO.findOne({ _id: sloId, team: teamId });
  if (!slo) {
    return null;
  }

  const clickhouseClient = createNativeClient({
    url: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
    request_timeout: ms('2m'),
  });

  try {
    // Calculate status from slo_aggregates (Source of Truth)
    const timeWindowMs = ms(slo.timeWindow);
    const windowStart = new Date(Date.now() - timeWindowMs);

    const statusQuery = `
        SELECT 
            sum(numerator_count) as numerator,
            sum(denominator_count) as denominator
        FROM default.slo_aggregates
        WHERE slo_id = {sloId: String}
          AND timestamp >= {windowStart: DateTime}
    `;

    const statusRes = await clickhouseClient.query({
      query: statusQuery,
      query_params: {
        sloId: slo.id,
        windowStart: windowStart.toISOString().slice(0, 19).replace('T', ' '),
      },
      format: 'JSON',
    });
    
    const statusData = await statusRes.json<{
      data: Array<{ numerator: number; denominator: number }>;
    }>();

    const numerator = Number(statusData.data?.[0]?.numerator || 0);
    const denominator = Number(statusData.data?.[0]?.denominator || 0);

    // If no data, return empty state
    if (denominator === 0 && numerator === 0) {
        return {
            slo,
            achieved: 100, // Default to 100% if no data
            target: slo.targetValue,
            errorBudgetRemaining: 100,
            status: SLOStatus.HEALTHY,
            numerator: 0,
            denominator: 0,
            windowStart,
            windowEnd: new Date(),
            timestamp: new Date(),
        };
    }

    // Calculate achieved percentage
    const achieved = denominator > 0 ? (numerator / denominator) * 100 : 100;

    // Calculate error budget remaining
    const errorBudgetTotal = (1 - slo.targetValue / 100) * timeWindowMs;
    const errorBudgetUsed = (1 - achieved / 100) * timeWindowMs;
    const errorBudgetRemaining = Math.max(0, errorBudgetTotal - errorBudgetUsed);
    const errorBudgetRemainingPercent =
      errorBudgetTotal > 0
        ? (errorBudgetRemaining / errorBudgetTotal) * 100
        : 0;

    // Determine status
    let status: SLOStatus;
    if (achieved >= slo.targetValue) {
      status = SLOStatus.HEALTHY;
    } else if (
      errorBudgetRemainingPercent > 0 &&
      errorBudgetRemainingPercent <= 10
    ) {
      status = SLOStatus.AT_RISK;
    } else {
      status = SLOStatus.BREACHED;
    }

    return {
      slo,
      achieved,
      target: slo.targetValue,
      errorBudgetRemaining: errorBudgetRemainingPercent,
      status,
      numerator,
      denominator,
      windowStart,
      windowEnd: new Date(),
      timestamp: new Date(),
    };

  } catch (error: any) {
    logger.warn(
      { error, sloId },
      'Failed to get SLO status from ClickHouse aggregates',
    );
  }

  // Fallback (rarely reached if CH is up)
  return null;
}

// computeSLOStatusOnDemand REMOVED - no longer needed as we use aggregates.

/**
 * Get SLO burn rate over time
 */
export async function getSLOBurnRate(
  sloId: string,
  teamId: ObjectId,
  timeStart: Date,
  timeEnd: Date,
): Promise<
  Array<{
    timestamp: Date;
    achieved: number;
    burnRate: number;
    errorBudgetRemaining: number;
  }>
> {
  const slo = await SLO.findOne({ _id: sloId, team: teamId });
  if (!slo) {
    throw new Error('SLO not found');
  }

  const clickhouseClient = createNativeClient({
    url: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
    request_timeout: ms('2m'),
  });

  // Aggregate by hour (or minute?) for the burn rate chart
  // Grouping by minute for high fidelity
  const result = await clickhouseClient.query({
    query: `
      SELECT
        timestamp,
        sum(numerator_count) as numerator,
        sum(denominator_count) as denominator
      FROM default.slo_aggregates
      WHERE slo_id = {sloId: String}
        AND timestamp >= {timeStart: DateTime}
        AND timestamp <= {timeEnd: DateTime}
      GROUP BY timestamp
      ORDER BY timestamp ASC
    `,
    query_params: {
      sloId: slo.id,
      timeStart: timeStart.toISOString().slice(0, 19).replace('T', ' '),
      timeEnd: timeEnd.toISOString().slice(0, 19).replace('T', ' '),
    },
    format: 'JSON',
  });

  const data = await result.json<{
    data: Array<{
      timestamp: string;
      numerator: number;
      denominator: number;
    }>;
  }>();

  // Burn rate logic: Rate of error budget consumption
  // This simplistic view just shows error rate trends.
  // A true "burn rate" is usually derived from a window. 
  // Here we just return the raw failure rate per bucket for visualization.
  
  return (data.data || []).map(d => {
      const num = Number(d.numerator);
      const den = Number(d.denominator);
      // const achieved = den > 0 ? (num / den) * 100 : 100;
      // "Burn Rate" for visualization often means "Error Rate" relative to allowed errors.
      // Let's just return Error Rate for now to keep the chart simple: (1 - success)
      const errorRate = den > 0 ? (1 - num/den) * 100 : 0;
      
      return {
          timestamp: new Date(d.timestamp),
          achieved: den > 0 ? (num / den) * 100 : 100,
          burnRate: errorRate, // Visualize spikes in errors
          errorBudgetRemaining: 0 // Not computed per-bucket for this chart
      };
  });
}

