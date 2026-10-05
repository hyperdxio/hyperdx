import { useEffect } from 'react';

import { INSTANCE_LABEL } from '@/config';

const SUFFIX = INSTANCE_LABEL ? ` ${INSTANCE_LABEL}` : '';

/**
 * Returns the instance-label suffix to append to a page title (empty string
 * when unset) for call sites that render their own `<title>`.
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
