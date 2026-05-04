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
  });
}

function useAddFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });
}

function useRemoveFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
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
