import { env } from 'next-runtime-env';
import { init } from '@clickhouse/clickstack-browser';

import { IS_LOCAL_MODE } from '@/config';
import type { NextApiConfigResponseData } from '@/types';
import { getBrowserInitOptions } from '@/utils/browserTelemetry';

// Next.js runs this file once per page load, before hydration. The collector
// settings come from /api/config at request time so they can change without a
// rebuild, which is why init waits for the fetch.
function startBrowserTelemetry(config: NextApiConfigResponseData | undefined) {
  if (!config?.apiKey) {
    console.warn('No API key found to enable OTEL exporter');
    return;
  }

  init(
    getBrowserInitOptions({
      config,
      resourceAttributes: env('NEXT_PUBLIC_OTEL_RESOURCE_ATTRIBUTES') ?? '',
      serviceVersion: process.env.NEXT_PUBLIC_APP_VERSION,
    }),
  );
}

if (!IS_LOCAL_MODE) {
  fetch('/api/config')
    .then(res => res.json())
    .then(startBrowserTelemetry)
    .catch(() => {
      // Telemetry is optional, so a failed config fetch must not surface
    });
}
