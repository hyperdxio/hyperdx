import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from './api';
import { IS_LOCAL_MODE } from './config';
import { createEntityStore } from './localStore';

export type Favorite = {
  id: string;
  resourceType: 'dashboard' | 'savedSearch';
  resourceId: string;
};

const localFavorites = createEntityStore<Favorite>('hdx-local-favorites');

async function fetchFavorites(): Promise<Favorite[]> {
  if (IS_LOCAL_MODE) {
    return localFavorites.getAll();
  }
  return hdxServer('favorites').json<Favorite[]>();
}

export function useFavorites() {
  return useQuery({
    queryKey: ['favorites'],
    queryFn: fetchFavorites,
    staleTime: 5_000,
  });
}

function useAddFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    // shared key with useRemoveFavorite to coordinate refetching and optimistic updates
    mutationKey: ['favorites'],
    mutationFn: (data: {
      resourceType: Favorite['resourceType'];
      resourceId: string;
    }) => {
      if (IS_LOCAL_MODE) {
        return Promise.resolve(localFavorites.create(data));
      }
      return hdxServer('favorites', {
        method: 'PUT',
        json: data,
      }).json<Favorite>();
    },
    onMutate: async data => {
      // Cancel any outgoing favorites refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ['favorites'] });

      // Get the previous value so that we can roll back if the mutation fails
      const previous = queryClient.getQueryData<Favorite[]>(['favorites']);

      // Optimistically update to the new value
      queryClient.setQueryData<Favorite[]>(['favorites'], old => [
        ...(old ?? []),
        { id: `optimistic-${Math.random().toString(36).slice(2)}`, ...data },
      ]);
      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context !== undefined) {
        queryClient.setQueryData(['favorites'], context.previous);
      }
    },
    onSettled: () => {
      // Only refetch once the last in-flight favorites mutation settles, so a
      // refetch with partially-committed server state can't clobber the
      // still-pending optimistic updates from other mutations.
      if (queryClient.isMutating({ mutationKey: ['favorites'] }) === 1) {
        queryClient.invalidateQueries({ queryKey: ['favorites'] });
      }
    },
  });
}

function useRemoveFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    // shared key with useRemoveFavorite to coordinate refetching and optimistic updates
    mutationKey: ['favorites'],
    mutationFn: (data: {
      resourceType: Favorite['resourceType'];
      resourceId: string;
    }) => {
      if (IS_LOCAL_MODE) {
        const all = localFavorites.getAll();
        const match = all.find(
          f =>
            f.resourceType === data.resourceType &&
            f.resourceId === data.resourceId,
        );
        if (match) {
          localFavorites.delete(match.id);
        }
        return Promise.resolve();
      }
      return hdxServer(`favorites/${data.resourceType}/${data.resourceId}`, {
        method: 'DELETE',
      }).json<void>();
    },
    onMutate: async data => {
      // Cancel any outgoing favorites refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ['favorites'] });

      // Get the previous value so that we can roll back if the mutation fails
      const previous = queryClient.getQueryData<Favorite[]>(['favorites']);

      // Optimistically update to the new value
      queryClient.setQueryData<Favorite[]>(['favorites'], old =>
        (old ?? []).filter(
          f =>
            !(
              f.resourceType === data.resourceType &&
              f.resourceId === data.resourceId
            ),
        ),
      );
      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context !== undefined) {
        queryClient.setQueryData(['favorites'], context.previous);
      }
    },
    onSettled: () => {
      // Only refetch once the last in-flight favorites mutation settles, so a
      // refetch with partially-committed server state can't clobber the
      // still-pending optimistic updates from other mutations.
      if (queryClient.isMutating({ mutationKey: ['favorites'] }) === 1) {
        queryClient.invalidateQueries({ queryKey: ['favorites'] });
      }
    },
  });
}

export function useToggleFavorite(
  resourceType: Favorite['resourceType'],
  resourceId: string,
) {
  const { data: favorites } = useFavorites();
  const addFavorite = useAddFavorite();
  const removeFavorite = useRemoveFavorite();

  const isFavorited =
    favorites?.some(
      f => f.resourceType === resourceType && f.resourceId === resourceId,
    ) ?? false;

  const toggleFavorite = () => {
    if (isFavorited) {
      removeFavorite.mutate({ resourceType, resourceId });
    } else {
      addFavorite.mutate({ resourceType, resourceId });
    }
  };

  return { isFavorited, toggleFavorite };
}
