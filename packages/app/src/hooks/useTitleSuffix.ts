import { useEffect } from 'react';

import { INSTANCE_LABEL } from '@/config';

// Collapsed defensively (not just relying on config.ts) since document.title
// collapses whitespace runs on write, and the dedup check below needs its
// comparison string to match what the browser will actually store.
const LABEL = INSTANCE_LABEL.replace(/\s+/g, ' ');
const SUFFIX = LABEL ? ` ${LABEL}` : '';

/**
 * Returns the instance-label suffix to append to `_app.tsx`'s own base
 * `<title>` (empty string when unset).
 *
 * Also keeps the browser tab's title suffixed as a side effect, for the many
 * existing pages that render their own `<title>X - {brandName}</title>` and
 * so override whatever `_app.tsx` renders — a MutationObserver is the only
 * way to reach those without threading the suffix through every page.
 */
export function useTitleSuffix(): string {
  useEffect(() => {
    if (!SUFFIX) {
      return;
    }
    const titleEl = document.querySelector('title');
    if (!titleEl) {
      return;
    }
    // document.title strips trailing whitespace, so discard our own write's
    // mutation record rather than trusting endsWith to stop the loop.
    const applySuffix = () => {
      if (document.title.endsWith(SUFFIX)) {
        return;
      }
      document.title = `${document.title}${SUFFIX}`;
      observer.takeRecords();
    };
    const observer = new MutationObserver(applySuffix);
    applySuffix();
    observer.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  return SUFFIX;
}
