import { ClickhouseClient, createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import ms from 'ms';

import * as config from '@/config';
import { getSources } from '@/controllers/sources';
import { getAllTeams } from '@/controllers/team';
import Service from '@/models/service';
import { ISource } from '@/models/source';
import logger from '@/utils/logger';
import { HdxTask, DiscoverServicesTaskArgs } from './types';
import { connectDB, mongooseConnection } from '@/models';

export default class DiscoverServicesTask implements HdxTask<DiscoverServicesTaskArgs> {
  private clickhouseClient: ClickhouseClient | null = null;

  constructor(private args: DiscoverServicesTaskArgs) {}

  async execute(): Promise<void> {
    logger.info('Starting service discovery task...');
    
    // Ensure DB connection if running as standalone task
    if (mongooseConnection.readyState !== 1) {
        await connectDB();
    }

    this.clickhouseClient = createNativeClient({
      url: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
      request_timeout: ms('1m'),
      compression: {
          request: false,
          response: false,
      },
    });

    const teams = await getAllTeams();
    let totalDiscovered = 0;

    for (const team of teams) {
      try {
        const sources = await getSources(team._id.toString());
        const logAndTraceSources = sources.filter(
          s => 
            (s.kind === 'log' || s.kind === 'trace') && 
            (s.from?.tableName === 'otel_logs' || s.from?.tableName === 'otel_traces')
        );

        if (logAndTraceSources.length === 0) continue;

        const serviceNames = new Set<string>();

        for (const source of logAndTraceSources) {
          const whereClause = source.tableFilterExpression || '1=1';
          const tableName = source.from!.tableName!;
          const serviceNameCol = source.serviceNameExpression || 'ServiceName';

          const query = `
            SELECT DISTINCT ${serviceNameCol} as name 
            FROM default.${tableName} 
            WHERE (${whereClause}) 
            AND Timestamp > now() - INTERVAL 1 HOUR
          `;

          try {
            const result = await this.clickhouseClient!.query({
              query,
              format: 'JSONEachRow',
            });
            const rows = await result.json<Array<{ name: string }>>();
            
            for (const row of rows) {
              if (row.name) {
                serviceNames.add(row.name);
              }
            }
          } catch (err) {
              logger.error({ err, teamId: team._id, sourceId: source._id }, 'Failed to query ClickHouse for services');
          }
        }

        // Upsert services for this team
        for (const name of serviceNames) {
          await Service.findOneAndUpdate(
            { team: team._id, name },
            { 
              $set: { 
                lastSeenAt: new Date(),
                // Default tier if new
                $setOnInsert: { tier: 'medium' }
              } 
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          totalDiscovered++;
        }
        
      } catch (err) {
        logger.error({ err, teamId: team._id }, 'Error discovering services for team');
      }
    }

    logger.info({ totalDiscovered }, 'Service discovery task completed');
  }

  async asyncDispose(): Promise<void> {
    if (this.clickhouseClient) {
        await this.clickhouseClient.close();
    }
  }

  name(): string {
    return 'DiscoverServicesTask';
  }
}
