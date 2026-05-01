import { useCallback, useMemo } from 'react';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

const STORAGE_KEY = 'hdx-optimization-dismissals';

type DismissalRecord = {
  pluginId: string;
  scopeId: string;
};

type DismissalMap = Record<string, DismissalRecord>;

const dismissalKey = (pluginId: string, scopeId: string) =>
  `${pluginId}::${scopeId}`;

const dismissalsAtom = atomWithStorage<DismissalMap>(STORAGE_KEY, {});

export function useOptimizationDismissals() {
  const [dismissals, setDismissals] = useAtom(dismissalsAtom);

  const isDismissed = useCallback(
    (pluginId: string, scopeId: string) =>
      Boolean(dismissals[dismissalKey(pluginId, scopeId)]),
    [dismissals],
  );

  const dismiss = useCallback(
    (pluginId: string, scopeId: string) => {
      const key = dismissalKey(pluginId, scopeId);
      setDismissals(prev => ({
        ...prev,
        [key]: { pluginId, scopeId },
      }));
    },
    [setDismissals],
  );

  const undismiss = useCallback(
    (pluginId: string, scopeId: string) => {
      const key = dismissalKey(pluginId, scopeId);
      setDismissals(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [setDismissals],
  );

  const dismissedScopes = useMemo(() => {
    const byPlugin = new Map<string, Set<string>>();
    for (const record of Object.values(dismissals)) {
      const set = byPlugin.get(record.pluginId) ?? new Set<string>();
      set.add(record.scopeId);
      byPlugin.set(record.pluginId, set);
    }
    return byPlugin;
  }, [dismissals]);

  return { dismissals, isDismissed, dismiss, undismiss, dismissedScopes };
}

// Test-only helpers; safe in production but unused.
export const __testing = {
  STORAGE_KEY,
  dismissalKey,
};
