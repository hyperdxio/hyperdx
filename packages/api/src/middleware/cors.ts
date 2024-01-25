import cors from 'cors';

import { FRONTEND_URL } from '@/config';

export const noCors = cors();

export default cors({ credentials: true, origin: FRONTEND_URL });
