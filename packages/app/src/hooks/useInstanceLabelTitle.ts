import { useEffect } from 'react';

import { INSTANCE_LABEL } from '@/config';

/** Appends INSTANCE_LABEL to the tab title via a MutationObserver, so every
 * page gets it without each one needing its own change. */
export function useInstanceLabelTitle(): void {
  useEffect(() => {
    if (!INSTANCE_LABEL) {
      return;
    }
    const suffix = ` ${INSTANCE_LABEL}`;
    const titleEl = document.querySelector('title');
    if (!titleEl) {
      return;
    }
    // document.title strips trailing whitespace, so discard our own write's
    // mutation record rather than trusting endsWith to stop the loop.
    const applySuffix = () => {
      if (document.title.endsWith(suffix)) {
        return;
      }
      document.title = `${document.title}${suffix}`;
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
}
