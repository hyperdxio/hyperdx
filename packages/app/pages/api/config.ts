import type { NextApiRequest, NextApiResponse } from 'next';

import {
  HDX_API_KEY,
  HDX_COLLECTOR_URL,
  HDX_EXPORTER_ENABLED,
  HDX_LOGS_URL,
  HDX_SERVICE_NAME,
  HDX_TRACES_URL,
} from '@/config';
import type { NextApiConfigResponseData } from '@/types';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<NextApiConfigResponseData>,
) {
  res.status(200).json({
    apiKey: HDX_EXPORTER_ENABLED ? HDX_API_KEY : undefined,
    collectorUrl: HDX_COLLECTOR_URL,
    tracesUrl: HDX_TRACES_URL,
    logsUrl: HDX_LOGS_URL,
    serviceName: HDX_SERVICE_NAME,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
  });
}
