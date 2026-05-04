import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Center, Text } from '@mantine/core';

import { withAppNav } from '@/layout';
import { buildTraceRedirectUrl } from '@/utils/directTrace';

export function TraceRedirectPage() {
  const { isReady, query, replace } = useRouter();
  const traceIdParam = Array.isArray(query.traceId)
    ? query.traceId[0]
    : query.traceId;

  useEffect(() => {
    if (!isReady) return;

    if (!traceIdParam) {
      replace('/search');
      return;
    }

    replace(
      buildTraceRedirectUrl({
        traceId: traceIdParam,
        search: window.location.search,
      }),
    );
  }, [isReady, replace, traceIdParam]);

  return (
    <Center h="100vh">
      <Text size="sm" c="dimmed">
        Redirecting to search...
      </Text>
    </Center>
  );
}

TraceRedirectPage.getLayout = withAppNav;

export default TraceRedirectPage;
