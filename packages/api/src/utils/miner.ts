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

export const detectAnomalies = async (
  history: { count: number; ts_bucket?: number }[][],
  strength?: number,
  anomalyConfig?: Record<string, any>,
): Promise<any> => {
  try {
    const response = await axios({
      method: 'POST',
      url: `${config.MINER_API_URL}/detect_anomalies`,
      data: {
        history: history,
        strength: strength,
        config: anomalyConfig,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: ms('2 minute'),
    });
    return response.data;
  } catch (error) {
    logger.error('Error detecting anomalies:', error);
    throw error;
  }
};

export const detectAnomaly = async (
  history: { count: number; ts_bucket?: number }[],
  current: { count: number; ts_bucket?: number },
  strength?: number,
  anomalyConfig?: Record<string, any>,
): Promise<any> => {
  try {
    const response = await axios({
      method: 'POST',
      url: `${config.MINER_API_URL}/detect_anomaly`,
      data: {
        history: history,
        current: current,
        strength: strength,
        config: anomalyConfig,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: ms('2 minute'),
    });
    return response.data;
  } catch (error) {
    logger.error('Error detecting anomalies:', error);
    throw error;
  }
};
