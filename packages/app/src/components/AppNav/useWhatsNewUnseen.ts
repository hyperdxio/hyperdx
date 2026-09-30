import { useCallback, useEffect, useState } from 'react';

// Client-only "have they read the latest release notes?" nudge, needing no
// fetch: the key is the newest release version in the notes, inlined at build
// time (see next.config.mjs).
//
// Deliberately not the app version. A deployment that stamps a build id into
// NEXT_PUBLIC_APP_VERSION mints a new version on every deploy, which sparkled
// Help for every user every time whether the notes had changed or not.
const SEEN_KEY = 'hdx-whats-new-seen';

// Compares the X.Y.Z prefix numerically, because '2.9.0' > '2.10.0' as strings
// while 2.10.0 is the newer release.
//
// parseInt stops at the first non-digit, so a build-stamped value left in
// localStorage by an older build ('2.37.0-sha0724861') compares equal to
// '2.37.0' — a browser that already read that release's notes is not nudged
// again just because the key's shape changed.
const isNewerRelease = (version: string, seen: string) => {
  const parts = (v: string) =>
    v.split('.').map(n => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(version), parts(seen)];
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
};

/**
 * Returns whether a release newer than the last one this browser acknowledged
 * has been published (drives the Help-button sparkle) plus a `markSeen` to call
 * when the user opens the Help menu.
 *
 * Strictly newer, not merely different, so a rollback does not re-nudge everyone
 * with notes they have already read.
 */
export const useWhatsNewUnseen = (
  version?: string,
): readonly [boolean, () => void] => {
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    if (!version) return;
    try {
      const seen = window.localStorage.getItem(SEEN_KEY);
      // A browser that has never acknowledged anything is nudged once.
      //
      // set-state-in-effect is disabled deliberately: localStorage is an external
      // system and this is a read-once-after-hydration sync of it, which is the
      // case the rule exists to make deliberate rather than to forbid. A lazy
      // useState initialiser can't replace it — the server has no localStorage,
      // so deriving the sparkle during the first render would mismatch the SSR
      // markup and get thrown away on hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasUnseen(seen === null || isNewerRelease(version, seen));
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
