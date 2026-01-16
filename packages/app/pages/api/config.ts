import type { NextApiRequest, NextApiResponse } from 'next';

import { HDX_API_KEY, HDX_EXPORTER_ENABLED, HDX_COLLECTOR_URL, HDX_SERVICE_NAME } from '@/config';
import type { NextApiConfigResponseData } from '@/types';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<NextApiConfigResponseData>,
) {
  res.status(200).json({
    exporterEnabled: HDX_EXPORTER_ENABLED,
    apiKey: HDX_API_KEY,
    collectorUrl: HDX_COLLECTOR_URL,
    serviceName: HDX_SERVICE_NAME,
  });
}
