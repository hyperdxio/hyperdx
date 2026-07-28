import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { notifications } from '@mantine/notifications';

import { decodeShareToken, SHARE_PARAM } from '@/utils/shareLink';

/**
 * On page load, expand a `?share=<token>` link back into the full set of query
 * params it encodes, then replace the URL (shallow) so all existing
 * `useQueryState` hooks read normal params. This is a no-op when there is no
 * share token, so it is backward compatible with existing long URLs.
 *
 * Reads directly from `window.location.search` (always accurate on the client)
 * rather than `router.query`, so it doesn't depend on router readiness timing.
 *
 * Call this near the top of any page that renders a ShareLinkButton.
 */
export function useExpandShareLink(): void {
  const router = useRouter();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) {
      return;
    }

    const token = new URLSearchParams(window.location.search).get(SHARE_PARAM);
    if (!token) {
      return;
    }
    handledRef.current = true;

    let cancelled = false;
    void (async () => {
      const expanded = await decodeShareToken(token);
      if (cancelled) {
        return;
      }
      if (expanded == null) {
        notifications.show({
          color: 'red',
          message: 'This shared link is invalid or corrupted.',
        });
        // Strip the bad token; render from whatever real params remain.
        router.replace(window.location.pathname, undefined, { shallow: true });
        return;
      }
      router.replace(`${window.location.pathname}?${expanded}`, undefined, {
        shallow: true,
      });
    })();

    return () => {
      cancelled = true;
    };
    // Run once on mount: window.location is the source of truth for the token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
