import {client} from '../client';
import logger from '@/utils/logger';
import { serializeError } from 'serialize-error';
import { sleep } from '@/utils/common';
import { TableName, getLogStreamTableName } from '../index';
import type {
    LogStreamModel,
    MetricModel,
    RrwebEventModel,
  } from '@/utils/logParser';

export const clientInsertWithRetries = async <T>({
    table,
    values,
    retries = 10,
    timeout = 10000,
  }: {
    table: string;
    values: T[];
    retries?: number;
    timeout?: number;
  }) => {
    let maxRetries = retries;
    const ts = Date.now();
    while (maxRetries > 0) {
      try {
        await client.insert({
          table,
          values,
          format: 'JSONEachRow',
        });
        break;
      } catch (err) {
        logger.error({
          message: `Failed to bulk insert. Sleeping for ${timeout} ms...`,
          table,
          n: values.length,
          error: serializeError(err),
          maxRetries,
        });
        await sleep(timeout);
        maxRetries--;
        if (maxRetries === 0) {
          // TODO: requeue the failed events
          throw err;
        }
        logger.warn({
          message: 'Retrying bulk insert...',
          table,
          n: values.length,
          maxRetries,
        });
      }
    }
    logger.info({
      message: `Bulk inserted table: ${table}`,
      table,
      n: values.length,
      took: Date.now() - ts,
    });
  };

export const bulkInsertRrwebEvents = async (events: RrwebEventModel[]) => {
    const tableName = `default.${TableName.Rrweb}`;
    await clientInsertWithRetries<RrwebEventModel>({
      table: tableName,
      values: events,
    });
  };
  
  export const bulkInsertTeamLogStream = async (
    version: number | undefined | null,
    teamId: string,
    logs: LogStreamModel[],
  ) => {
    const tableName = getLogStreamTableName(version, teamId);
    await clientInsertWithRetries<LogStreamModel>({
      table: tableName,
      values: logs,
    });
  };
  
  export const bulkInsertTeamMetricStream = async (metrics: MetricModel[]) => {
    const tableName = `default.${TableName.Metric}`;
    await clientInsertWithRetries<MetricModel>({
      table: tableName,
      values: metrics,
    });
  };