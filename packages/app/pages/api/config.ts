import type { NextApiRequest, NextApiResponse } from 'next';

import {
  HDX_API_KEY,
  HDX_COLLECTOR_URL,
  HDX_LOCAL_DEFAULT_CONNECTIONS,
  HDX_LOCAL_DEFAULT_SOURCES,
  HDX_SERVICE_NAME,
  SERVER_URL,
} from '@/config';
import type { NextApiConfigResponseData } from '@/types';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<NextApiConfigResponseData>,
) {
  res.status(200).json({
    apiKey: HDX_API_KEY,
    apiServerUrl: SERVER_URL,
    collectorUrl: HDX_COLLECTOR_URL,
    defaultConnections: HDX_LOCAL_DEFAULT_CONNECTIONS,
    defaultSources: HDX_LOCAL_DEFAULT_SOURCES,
    serviceName: HDX_SERVICE_NAME,
  });
}
