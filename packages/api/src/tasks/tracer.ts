import opentelemetry from '@opentelemetry/api';

import { CODE_VERSION } from '@/config';

export const tasksTracer = opentelemetry.trace.getTracer(
  'hyperdx-tasks',
  CODE_VERSION,
);
