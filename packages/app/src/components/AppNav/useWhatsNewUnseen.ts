import { useCallback, useEffect, useState } from 'react';

// Client-only "have they seen the latest release?" nudge. The latest release is
// just the running app version (whats-new.json's version === APP_VERSION, both
// baked from package.json at build), so no fetch is needed — we compare the
// version to the last one this browser acknowledged.
const SEEN_KEY = 'hdx-whats-new-seen';

/**
 * Returns whether the current release is unseen (drives the Help-button
 * sparkle) plus a `markSeen` to call when the user opens the Help menu.
 *
 * A browser that has never acknowledged a version is treated as unseen, so the
 * indicator shows once until the menu is opened (then it's marked seen).
 */
export const useWhatsNewUnseen = (
  version?: string,
): readonly [boolean, () => void] => {
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    if (!version) return;
    try {
      // Never-seen (null) !== version, so a fresh browser shows the indicator.
      //
      // set-state-in-effect is disabled deliberately: localStorage is an external
      // system and this is a read-once-after-hydration sync of it, which is the
      // case the rule exists to make deliberate rather than to forbid. A lazy
      // useState initialiser can't replace it — the server has no localStorage,
      // so deriving the sparkle during the first render would mismatch the SSR
      // markup and get thrown away on hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasUnseen(window.localStorage.getItem(SEEN_KEY) !== version);
    } catch {
      // localStorage can throw (private mode, disabled storage) — just don't
      // nudge rather than break the nav.
      setHasUnseen(false);
    }
  }, [version]);

  const markSeen = useCallback(() => {
    if (!version) return;
    try {
      window.localStorage.setItem(SEEN_KEY, version);
    } catch {
      // ignore — see above
    }
    setHasUnseen(false);
  }, [version]);

  return [hasUnseen, markSeen] as const;
};
