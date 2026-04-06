import {
  SavedSearch,
  SavedSearchListApiResponse,
} from '@hyperdx/common-utils/dist/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';

import { hdxServer } from './api';
import { IS_LOCAL_MODE } from './config';
import { localSavedSearches } from './localStore';

async function fetchSavedSearches(): Promise<SavedSearchListApiResponse[]> {
  if (IS_LOCAL_MODE) {
    // Locally stored saved searches never have alert data (alerts are cloud-only)
    return localSavedSearches.getAll() as SavedSearchListApiResponse[];
  }
  return hdxServer('saved-search').json<SavedSearchListApiResponse[]>();
}

export function useSavedSearches() {
  return useQuery({
    queryKey: ['saved-search'],
    queryFn: fetchSavedSearches,
  });
}

export function useSavedSearch(
  { id }: { id: string },
  options: Omit<
    Partial<UseQueryOptions<SavedSearchListApiResponse[], Error>>,
    'select'
  > = {},
) {
  return useQuery({
    queryKey: ['saved-search'],
    queryFn: fetchSavedSearches,
    select: data => data.find(s => s.id === id),
    ...options,
  });
}

export function useCreateSavedSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<SavedSearch, 'id'>) => {
      if (IS_LOCAL_MODE) {
        return Promise.resolve(localSavedSearches.create(data));
      }
      return hdxServer('saved-search', {
        method: 'POST',
        json: data,
      }).json<SavedSearch>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-search'] });
    },
  });
}

export function useUpdateSavedSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<SavedSearch> & { id: SavedSearch['id'] }) => {
      if (IS_LOCAL_MODE) {
        const { id, ...updates } = data;
        return Promise.resolve(localSavedSearches.update(id, updates));
      }
      return hdxServer(`saved-search/${data.id}`, {
        method: 'PATCH',
        json: data,
      }).json<SavedSearch>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-search'] });
    },
  });
}

export function useDeleteSavedSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      if (IS_LOCAL_MODE) {
        localSavedSearches.delete(id);
        return Promise.resolve();
      }
      return hdxServer(`saved-search/${id}`, { method: 'DELETE' }).json<void>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-search'] });
    },
  });
}
