import * as React from 'react';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { MeApiResponse, UserLabs } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import api, { hdxServer, ME_QUERY_KEY } from '@/api';
import { IS_LOCAL_MODE } from '@/config';
import { LABS } from '@/labs/registry';

export type LabsState = {
  /**
   * Enabled state for every lab in the current registry, keyed by lab id. Ids
   * stored on the user but absent from the registry (a graduated or retired
   * lab) are not surfaced here — see agent_docs/labs.md.
   */
  enabled: Record<string, boolean>;
  /**
   * True until the stored answer is known. Every lab reads OFF while this is
   * true, so anything where an OFF -> ON flip is user-visible (a redirect, a
   * default tab, a one-shot effect, a mount-time fetch) should branch on it
   * rather than on `enabled` alone. Always false in local mode, which reads
   * synchronously from localStorage.
   */
  isLoading: boolean;
  /** True while a toggle is in flight. */
  isSaving: boolean;
  setLabEnabled: (labId: string, enabled: boolean) => void;
};

/**
 * Local-mode store. Local mode has no API server and no user identity —
 * `useMe()` resolves to null there — so there is no account to hang an opt-in
 * on, and the choice lives in localStorage instead. Same jotai + localStorage
 * shape as the other per-browser preferences in this app.
 *
 * This is the only reason `useLabs` branches on IS_LOCAL_MODE, and it is
 * deliberately confined to this file.
 */
const localLabsAtom = atomWithStorage<UserLabs>('hdx-labs', {});

/**
 * Persists the caller's full lab set. Optimistic, because this backs a Switch:
 * with a plain mutate-then-refetch the control would sit dead for two round
 * trips. Shape mirrors src/favorites.ts, including the isMutating guard.
 */
function useUpdateUserLabs() {
  const queryClient = useQueryClient();

  return useMutation({
    // Shared with the /me query key so concurrent toggles coordinate their
    // refetch rather than racing each other.
    mutationKey: ME_QUERY_KEY,
    mutationFn: (labs: UserLabs) =>
      hdxServer('me/labs', {
        method: 'PATCH',
        json: { labs },
      }).json<{ labs: UserLabs }>(),
    onMutate: async (labs: UserLabs) => {
      // Cancel outgoing /me refetches so they can't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });

      const previous = queryClient.getQueryData<MeApiResponse | null>(
        ME_QUERY_KEY,
      );

      queryClient.setQueryData<MeApiResponse | null>(ME_QUERY_KEY, old =>
        old ? { ...old, labs } : old,
      );

      return { previous };
    },
    onError: (_err, _labs, context) => {
      if (context !== undefined) {
        queryClient.setQueryData(ME_QUERY_KEY, context.previous);
      }
      notifications.show({
        color: 'red',
        message: 'Failed to update HyperDX Labs',
      });
    },
    onSettled: () => {
      // Only refetch once the last in-flight toggle settles, so a /me refetch
      // carrying partially-committed state can't clobber a still-pending
      // optimistic update from another toggle.
      if (queryClient.isMutating({ mutationKey: ME_QUERY_KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      }
    },
  });
}

/**
 * The single seam for HyperDX Labs state. Local-mode branching, loading
 * semantics, and the write all live here — consumers gating a feature should
 * use {@link useIsLabEnabled} instead.
 */
export function useLabs(): LabsState {
  const { data: me, isPending } = api.useMe();
  const { mutate: updateLabs, isPending: isSaving } = useUpdateUserLabs();
  const [localLabs, setLocalLabs] = useAtom(localLabsAtom);

  // The one branch: an account when there is one, this browser when there isn't.
  const stored = IS_LOCAL_MODE ? localLabs : me?.labs;

  const enabled = React.useMemo(() => {
    // Derived from the registry, not from what's stored: an id the registry no
    // longer knows about can never reach a consumer or the modal.
    const result: Record<string, boolean> = {};
    for (const lab of LABS) {
      // `=== true` rather than truthiness. A key like `constructor` passes the
      // lab-id regex and is inherited from Object.prototype, where it is
      // truthy; only an own `true` should read as enabled.
      result[lab.id] = stored?.[lab.id] === true;
    }
    return result;
  }, [stored]);

  const setLabEnabled = React.useCallback(
    (labId: string, value: boolean) => {
      // Full-replace payload rebuilt from the registry. Two things fall out of
      // this for free: ids of retired labs are pruned, and only enabled entries
      // are stored, which keeps the document small.
      const next: UserLabs = {};
      for (const lab of LABS) {
        const isOn = lab.id === labId ? value : stored?.[lab.id] === true;
        if (isOn) {
          next[lab.id] = true;
        }
      }

      if (IS_LOCAL_MODE) {
        setLocalLabs(next);
        return;
      }
      updateLabs(next);
    },
    [stored, updateLabs, setLocalLabs],
  );

  return {
    enabled,
    // localStorage is read synchronously, so local mode is never pending.
    isLoading: !IS_LOCAL_MODE && isPending,
    isSaving: IS_LOCAL_MODE ? false : isSaving,
    setLabEnabled,
  };
}

/**
 * Whether the current user has opted into a lab. Returns `false` while the
 * stored set is still loading; if that transition is user-visible, use
 * {@link useLabs} and branch on `isLoading`.
 *
 * An id with no registry entry always reads `false`, which is what makes
 * deleting an entry safe — but it also means a typo fails silently, so grep for
 * the id after you delete one. See agent_docs/labs.md.
 */
export function useIsLabEnabled(labId: string): boolean {
  const { enabled } = useLabs();
  return enabled[labId] === true;
}
