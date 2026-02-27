import { testLocalConnection } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Connection } from '@hyperdx/common-utils/dist/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { IS_LOCAL_MODE } from '@/config';
import { localConnections } from '@/localStore';

// Exported so storage event listeners in other modules can filter by key
export const LOCAL_STORE_CONNECTIONS_KEY = 'hdx-local-connections';

export function getLocalConnections(): Connection[] {
  return localConnections.getAll();
}

/**
 * localStorage doesn't fire storage events to the same tab, so we dispatch
 * manually so that same-tab listeners (useMetadata, DBSearchPage) are notified.
 */
function dispatchConnectionsChangedEvent(newConnections: Connection[]): void {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: LOCAL_STORE_CONNECTIONS_KEY,
      newValue: JSON.stringify(newConnections),
      storageArea: window.localStorage,
      url: window.location.href,
    }),
  );
}

export function useConnections() {
  return useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => {
      if (IS_LOCAL_MODE) {
        return localConnections.getAll();
      }
      return hdxServer('connections').json();
    },
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();

  return useMutation<
    { id: string },
    Error,
    { connection: Omit<Connection, 'id'> }
  >({
    mutationFn: async ({ connection }) => {
      if (IS_LOCAL_MODE) {
        const isValid = await testLocalConnection({
          host: connection.host,
          username: connection.username,
          password: connection.password ?? '',
        });

        if (!isValid) {
          throw new Error(
            'Could not connect to Clickhouse with connection details',
          );
        }

        const id = 'local';
        const newConnections: Connection[] = [{ ...connection, id }];
        // Single-connection semantics: replace the whole collection
        localConnections.set(newConnections);
        dispatchConnectionsChangedEvent(newConnections);
        return { id };
      }

      return hdxServer('connections', {
        method: 'POST',
        json: connection,
      }).json<{ id: string }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      connection,
      id,
    }: {
      connection: Connection;
      id: string;
    }) => {
      if (IS_LOCAL_MODE) {
        const newConnections: Connection[] = [{ ...connection, id: 'local' }];
        localConnections.set(newConnections);
        dispatchConnectionsChangedEvent(newConnections);
        return;
      }

      await hdxServer(`connections/${id}`, {
        method: 'PUT',
        json: connection,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (IS_LOCAL_MODE) {
        localConnections.delete(id);
        dispatchConnectionsChangedEvent(localConnections.getAll());
        return;
      }

      await hdxServer(`connections/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
