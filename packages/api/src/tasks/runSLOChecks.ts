import { createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import PQueue from '@esm2cjs/p-queue';
import ms from 'ms';

import * as config from '@/config';
import { injectTimeFilter } from '@/controllers/slo';
import { connectDB, mongooseConnection } from '@/models';
import SLO from '@/models/slo';
import { CheckSLOsTaskArgs, HdxTask } from '@/tasks/types';
import logger from '@/utils/logger';

export default class RunSLOChecksTask implements HdxTask<CheckSLOsTaskArgs> {
  constructor(private args: CheckSLOsTaskArgs) {}

  async execute(): Promise<void> {
    logger.info('Starting SLO checks...');

    // Connect to MongoDB
    try {
      await connectDB();
      logger.debug('Connected to MongoDB for SLO checks');
    } catch (error: any) {
      logger.error(
        {
          error: {
            message: error?.message || String(error),
            stack: error?.stack,
            name: error?.name,
          },
        },
        `Failed to connect to MongoDB: ${error?.message || String(error)}`,
      );
      throw error;
    }

    let slos;
    try {
      // Fetch all active SLOs
      slos = await SLO.find({});
      logger.info(`Found ${slos.length} SLOs to check`);
    } catch (error: any) {
      logger.error(
        {
          error: {
            message: error?.message || String(error),
            stack: error?.stack,
            name: error?.name,
          },
        },
        `Failed to fetch SLOs from database: ${error?.message || String(error)}`,
      );
      throw error;
    }

    if (slos.length === 0) {
      logger.info('No SLOs found to check');
      return;
    }

    let clickhouseClient;
    try {
      clickhouseClient = createNativeClient({
        url: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
        request_timeout: ms('2m'),
      });
    } catch (error: any) {
      logger.error(
        {
          error: {
            message: error?.message || String(error),
            stack: error?.stack,
            name: error?.name,
          },
        },
        `Failed to create ClickHouse client: ${error?.message || String(error)}`,
      );
      throw error;
    }

    const now = new Date();
    // Align to the last complete minute to avoid partial data
    const lastMinute = new Date(now);
    lastMinute.setSeconds(0, 0);
    const endTime = lastMinute;

    // Process SLOs in parallel with a concurrency limit
    const queue = new PQueue({ concurrency: 10 });

    for (const slo of slos) {
      queue.add(async () => {
        try {
          logger.info({ sloId: slo.id }, 'Aggregating SLO metrics');

          // Validate SLO configuration
          if (!slo.sourceTable) {
            logger.error({ sloId: slo.id }, 'SLO is missing required field "sourceTable"');
            throw new Error(
              `SLO ${slo.id} is missing required field 'sourceTable'`,
            );
          }

          // 1. Determine Aggregation Window
          // Default to last minute if no previous aggregation
          // If lastAggregatedAt is present, we go from there up to now (or max 1 hour catchup)
          let startTime =
            slo.lastAggregatedAt || new Date(endTime.getTime() - ms('1m'));

          // Ensure we don't double-count or go backwards
          if (startTime >= endTime) {
            return;
          }

          // Cap at 1 hour catchup to prevent massive queries if system was down
          if (endTime.getTime() - startTime.getTime() > ms('1h')) {
            startTime = new Date(endTime.getTime() - ms('1h'));
          }

          // 2. Aggregate New Data (Incremental)
          if (slo.filter && slo.goodCondition) {
            // Builder Mode: Efficient aggregation via SELECT then INSERT
            const selectQuery = `
                  SELECT
                      toStartOfMinute(Timestamp) as timestamp,
                      countIf(${slo.goodCondition}) as numerator_count,
                      count() as denominator_count
                  FROM default.${slo.sourceTable}
                  WHERE ${slo.filter} 
                    AND Timestamp >= '${startTime.toISOString().slice(0, 19).replace('T', ' ')}'
                    AND Timestamp < '${endTime.toISOString().slice(0, 19).replace('T', ' ')}'
                  GROUP BY timestamp
              `;

            logger.info({ sloId: slo.id }, 'Running builder mode SELECT query');
            const resultSet = await clickhouseClient.query({ query: selectQuery, format: 'JSON' });
            const result = (await resultSet.json()) as {
              data: Array<{
                timestamp: string;
                numerator_count: string | number;
                denominator_count: string | number;
              }>;
            };

            logger.info({ sloId: slo.id, resultCount: result.data.length }, 'Finished builder mode SELECT query');

            if (result.data.length > 0) {
              const values = result.data
                .map(
                  row =>
                    `('${slo.id}', '${row.timestamp}', ${Number(
                      row.numerator_count,
                    )}, ${Number(row.denominator_count)})`,
                )
                .join(',');

              const insertQuery = `INSERT INTO default.slo_aggregates (slo_id, timestamp, numerator_count, denominator_count) VALUES ${values}`;

              // Use fetch to bypass client library issues with INSERT
              const response = await fetch(config.CLICKHOUSE_HOST, {
                method: 'POST',
                headers: {
                  Authorization: `Basic ${Buffer.from(
                    `${config.CLICKHOUSE_USER}:${config.CLICKHOUSE_PASSWORD}`,
                  ).toString('base64')}`,
                },
                body: insertQuery,
              });

              if (!response.ok) {
                const text = await response.text();
                throw new Error(
                  `ClickHouse INSERT failed: ${response.status} ${response.statusText} - ${text}`,
                );
              }

              logger.info(
                { sloId: slo.id, count: result.data.length },
                'Inserted aggregated SLO metrics',
              );
            }
          } else {
            // Raw SQL Mode: Best effort aggregation (assuming count() query)
            // We inject time filter into user's query
            // Note: This inserts a SINGLE row for the window if we can't group by minute easily.
            // This is acceptable for 1-minute cron intervals.

            const numQuery = injectTimeFilter(
              slo.numeratorQuery!,
              startTime,
              endTime,
            );
            const denQuery = injectTimeFilter(
              slo.denominatorQuery!,
              startTime,
              endTime,
            );

            const [numRes, denRes] = await Promise.all([
              clickhouseClient.query({ query: numQuery, format: 'JSON' }),
              clickhouseClient.query({ query: denQuery, format: 'JSON' }),
            ]);

            const numData = (await numRes.json()) as {
              data: Array<{ count: number }>;
            };
            const denData = (await denRes.json()) as {
              data: Array<{ count: number }>;
            };

            const numerator = Number(numData.data?.[0]?.count || 0);
            const denominator = Number(denData.data?.[0]?.count || 0);

            if (denominator > 0 || numerator > 0) {
              await clickhouseClient.insert({
                table: 'default.slo_aggregates',
                values: [
                  {
                    slo_id: slo.id,
                    timestamp: startTime, // Attribute entire count to start of window
                    numerator_count: numerator,
                    denominator_count: denominator,
                  },
                ],
                format: 'JSONEachRow',
                clickhouse_settings: {
                  // Allows to insert serialized JS Dates
                  date_time_input_format: 'best_effort',
                  wait_end_of_query: 1,
                },
              });
            }
          }

          // Update last aggregated timestamp
          await SLO.updateOne({ _id: slo._id }, { lastAggregatedAt: endTime });

          // Note: We no longer compute/insert into 'slo_measurements'.
          // The API queries 'slo_aggregates' directly for status and burn rate charts.
          // This simplifies the architecture and ensures a single source of truth.
        } catch (error: any) {
          logger.error(
            {
              sloId: slo.id,
              sloName: slo.sloName,
              serviceName: slo.serviceName,
              error: {
                message: error?.message || String(error),
                stack: error?.stack,
                name: error?.name,
              },
            },
            `Failed to check SLO ${slo.id}: ${error?.message || String(error)}`,
          );
        }
      });
    }

    try {
      await queue.onIdle();
      logger.info('Finished SLO checks');
    } catch (error: any) {
      logger.error(
        {
          error: {
            message: error?.message || String(error),
            stack: error?.stack,
            name: error?.name,
          },
        },
        `Queue processing failed: ${error?.message || String(error)}`,
      );
      throw error;
    }
  }

  name(): string {
    return this.args.taskName;
  }

  async asyncDispose(): Promise<void> {
    // Close MongoDB connection
    try {
      await mongooseConnection.close();
      logger.debug('Closed MongoDB connection for SLO checks');
    } catch (error: any) {
      logger.error(
        {
          error: {
            message: error?.message || String(error),
            stack: error?.stack,
            name: error?.name,
          },
        },
        `Failed to close MongoDB connection: ${error?.message || String(error)}`,
      );
    }
  }
}


