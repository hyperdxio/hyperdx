/**
 * Berg compatibility shim. The Connection model has been deleted from the
 * data layer; the UI components that still call into this module are
 * scheduled for removal in Tasks 9/10/11. Until then, these no-op hooks
 * return empty arrays so the rest of the app still compiles.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// Berg has no Connection model. Local nominal type so the legacy callers
// keep type-checking until they are deleted alongside the SQL editor.
export type Connection = {
  id: string;
  name?: string;
  host?: string;
  username?: string;
  password?: string;
};

export const LOCAL_STORE_CONNECTIONS_KEY = 'connections';

export function getLocalConnections(): Connection[] {
  return [];
}

export function useConnections() {
  return useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => Promise.resolve([] as Connection[]),
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation<
    { id: string },
    Error,
    { connection: Omit<Connection, 'id'> }
  >({
    mutationFn: async () =>
      Promise.reject(new Error('Connection model removed in Berg')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      Promise.reject(new Error('Connection model removed in Berg')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      Promise.reject(new Error('Connection model removed in Berg')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
