import { useEffect } from 'react';
import { useRouter } from 'next/router';

// The standalone Chart Explorer has been folded into the unified Explore page
// as its "chart" mode. Preserve old deep links by redirecting here, mapping the
// former `config` query param onto the Explore page's `chartConfig` param.
export default function ChartRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    const { config, ...rest } = router.query;
    const query: Record<string, string | string[]> = {
      ...(rest as Record<string, string | string[]>),
      mode: 'chart',
    };
    if (config != null) {
      query.chartConfig = config;
    }

    router.replace({ pathname: '/search', query });
  }, [router]);

  return null;
}
