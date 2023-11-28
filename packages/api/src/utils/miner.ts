import axios from 'axios';
import ms from 'ms';

import * as config from '@/config';
import logger from './logger';

const MAX_LOG_LINES = 1e4;

export const getLogsPatterns = async (
  teamId: string,
  lines: string[][],
): Promise<{
  patterns: Record<string, string>;
  result: Record<string, string>;
}> => {
  if (lines.length > MAX_LOG_LINES) {
    logger.error(`Too many log lines requested: ${lines.length}`);
  }

  return axios({
    method: 'POST',
    url: `${config.MINER_API_URL}/logs`,
    data: {
      team_id: teamId,
      lines: lines.slice(0, MAX_LOG_LINES),
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: ms('2 minute'),
  }).then(response => response.data);
};
