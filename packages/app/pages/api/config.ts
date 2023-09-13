import type { NextApiRequest, NextApiResponse } from 'next';

import { HDX_API_KEY } from '../../src/config';

type ResponseData = {
  apiKey: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>,
) {
  res.status(200).json({
    apiKey: HDX_API_KEY,
  });
}
