import type { NextApiRequest, NextApiResponse } from 'next';

import {
  HDX_API_KEY,
  HDX_COLLECTOR_URL,
  HDX_EXPORTER_ENABLED,
  HDX_LOGS_COLLECTOR_URL,
  HDX_METRICS_COLLECTOR_URL,
  HDX_SERVICE_NAME,
  HDX_TRACES_COLLECTOR_URL,
} from '@/config';
import type { NextApiConfigResponseData } from '@/types';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<NextApiConfigResponseData>,
) {
  res.status(200).json({
    apiKey: HDX_EXPORTER_ENABLED ? HDX_API_KEY : undefined,
    collectorUrl: HDX_COLLECTOR_URL,
    collectorTracesUrl: HDX_TRACES_COLLECTOR_URL,
    collectorMetricsUrl: HDX_METRICS_COLLECTOR_URL,
    collectorLogsUrl: HDX_LOGS_COLLECTOR_URL,
    serviceName: HDX_SERVICE_NAME,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
  });
}
