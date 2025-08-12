import { z } from 'zod';
import { SavedSearch } from '@hyperdx/common-utils/dist/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';

import { hdxServer } from './api';
import { IS_LOCAL_MODE } from './config';
import { SavedSearchWithEnhancedAlerts } from './types';

export function useSavedSearches() {
  return useQuery({
    queryKey: ['saved-search'],
    queryFn: async () => {
      if (IS_LOCAL_MODE) {
        return [];
      } else {
        return hdxServer('saved-search').json<
          SavedSearchWithEnhancedAlerts[]
        >();
      }
    },
  });
}

export function useSavedSearch(
  { id }: { id: string },
  options: Omit<
    Partial<UseQueryOptions<SavedSearchWithEnhancedAlerts[], Error>>,
    'select'
  > = {},
) {
  return useQuery({
    queryKey: ['saved-search'],
    queryFn: () => {
      if (IS_LOCAL_MODE) {
        return [];
      }
      return hdxServer('saved-search').json<SavedSearchWithEnhancedAlerts[]>();
    },
    select: data => data.find(s => s.id === id),
    ...options,
  });
}

export function useCreateSavedSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<SavedSearch, 'id'>) => {
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
      return hdxServer(`saved-search/${id}`, { method: 'DELETE' }).json<void>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-search'] });
    },
  });
}
