
import * as config from '@/config';
import logger from '@/utils/logger';
import { redisClient } from '../../utils/redis';
import SqlString from 'sqlstring';
import { TableName } from '../index';
import {client} from '../client';
import ms from 'ms';
import type { ResponseJSON, ResultSet } from '@clickhouse/client';

export const getMetricsTags = async (teamId: string) => {
    if (config.CACHE_METRICS_TAGS) {
      logger.info({
        message: 'getMetricsTags: attempting cached fetch',
        teamId: teamId,
      });
      return getMetricsTagsCached(teamId);
    } else {
      logger.info({
        message: 'getMetricsTags: skipping cache, direct query',
        teamId: teamId,
      });
      return getMetricsTagsUncached(teamId);
    }
  };

  const getMetricsTagsUncached = async (teamId: string) => {
    const tableName = `default.${TableName.Metric}`;
    // TODO: remove 'data_type' in the name field
    const query = SqlString.format(
      `
          SELECT 
            format('{} - {}', name, data_type) as name,
            data_type,
            groupUniqArray(_string_attributes) AS tags
          FROM ??
          GROUP BY name, data_type
          ORDER BY name
      `,
      [tableName],
    );
    const ts = Date.now();
    const rows = await client.query({
      query,
      format: 'JSON',
    });
    const result = await rows.json<ResponseJSON<{ names: string[] }>>();
    logger.info({
      message: 'getMetricsProps',
      query,
      took: Date.now() - ts,
    });
    return result;
  };

  const getMetricsTagsCached = async (teamId: string) => {
    const redisKey = `metrics-tags-${teamId}`;
    const cached = await redisClient.get(redisKey);
    if (cached) {
      logger.info({
        message: 'getMetricsTags: cache hit',
        teamId: teamId,
      });
      return JSON.parse(cached);
    } else {
      logger.info({
        message: 'getMetricsTags: cache miss',
        teamId: teamId,
      });
      const result = await getMetricsTagsUncached(teamId);
      await redisClient.set(redisKey, JSON.stringify(result), {
        PX: ms(config.CACHE_METRICS_EXPIRATION_IN_SEC.toString() + 's'),
      });
      return result;
    }
  };