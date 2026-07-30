import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';

/** The path part of a Next router URL, which may carry a query and a hash. */
function pathnameOf(url: string) {
  return url.split('?')[0].split('#')[0];
}

/**
 * Tracks whether the app is on its way to a different page.
 *
 * Pages that mirror local state into a URL param shared with another page need
 * this. During a client-side transition the outgoing page stays mounted while
 * the destination renders, so both write that param and overwrite each other —
 * which can run away until React bails out with "Maximum update depth
 * exceeded". Such a page should stop writing once it is leaving and let the
 * destination decide.
 *
 * `router.pathname` can't answer the question: by the time the outgoing page
 * re-renders it already reads as the destination. `routeChangeStart` fires
 * before that and names where we are headed.
 *
 * Returned as a ref rather than state, because the answer is only ever needed
 * inside an effect and reading it must not trigger the render it exists to
 * prevent.
 */
export function useRouteChangeState() {
  const router = useRouter();
  const isLeavingPageRef = useRef(false);

  useEffect(() => {
    const onRouteChangeStart = (url: string) => {
      // nuqs writes params through the Next router on the Pages Router, so a
      // page's own param updates raise this event too. Only a change of path
      // means we are actually leaving.
      isLeavingPageRef.current =
        pathnameOf(url) !== pathnameOf(window.location.pathname);
    };
    // Either we never left (a cancelled or failed navigation) or we arrived
    // somewhere still served by this component — a different path on the same
    // dynamic route. Both mean this page is staying, so let it write again.
    const onSettled = () => {
      isLeavingPageRef.current = false;
    };

    router.events.on('routeChangeStart', onRouteChangeStart);
    router.events.on('routeChangeComplete', onSettled);
    router.events.on('routeChangeError', onSettled);
    return () => {
      router.events.off('routeChangeStart', onRouteChangeStart);
      router.events.off('routeChangeComplete', onSettled);
      router.events.off('routeChangeError', onSettled);
    };
  }, [router.events]);

  return { isLeavingPageRef };
}
