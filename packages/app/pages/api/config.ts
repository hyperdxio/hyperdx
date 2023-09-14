import type { NextApiRequest, NextApiResponse } from 'next';

import {
  HDX_API_KEY,
  HDX_COLLECTOR_URL,
  HDX_SERVICE_NAME,
} from '../../src/config';

type ResponseData = {
  apiKey: string;
  collectorUrl: string;
  serviceName: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>,
) {
  res.status(200).json({
    apiKey: HDX_API_KEY,
    collectorUrl: HDX_COLLECTOR_URL,
    serviceName: HDX_SERVICE_NAME,
  });
}
