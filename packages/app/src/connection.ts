import store from 'store2';
import { testLocalConnection } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Connection } from '@hyperdx/common-utils/dist/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { HDX_LOCAL_DEFAULT_CONNECTIONS, IS_LOCAL_MODE } from '@/config';
import { parseJSON } from '@/utils';

export const LOCAL_STORE_CONNECTIONS_KEY = 'connections';

function setLocalConnections(newConnections: Connection[]) {
  // sessionStorage doesn't send a storage event to the open tab, only to
  // other tabs. Dispatch one manually for same-tab listeners.
  const storageEvent = new StorageEvent('storage', {
    key: LOCAL_STORE_CONNECTIONS_KEY,
    oldValue: store.session.get(LOCAL_STORE_CONNECTIONS_KEY),
    newValue: JSON.stringify(newConnections),
    storageArea: window.sessionStorage,
    url: window.location.href,
  });
  store.session.set(LOCAL_STORE_CONNECTIONS_KEY, newConnections);
  window.dispatchEvent(storageEvent);
}

export function getLocalConnections(): Connection[] {
  if (store.session.has(LOCAL_STORE_CONNECTIONS_KEY)) {
    return store.session.get(LOCAL_STORE_CONNECTIONS_KEY) ?? [];
  }
  try {
    const defaultConnections = parseJSON(HDX_LOCAL_DEFAULT_CONNECTIONS ?? '');
    if (defaultConnections != null) {
      return defaultConnections;
    }
  } catch (e) {
    console.error('Error fetching default connections', e);
  }
  return [];
}

export function useConnections() {
  return useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => {
      if (IS_LOCAL_MODE) {
        return getLocalConnections();
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

        const createdConnection = { id: 'local' };
        setLocalConnections([{ ...connection, ...createdConnection }]);
        return createdConnection;
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
        setLocalConnections([{ ...connection, id: 'local' }]);
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
        const connections = getLocalConnections();
        setLocalConnections(connections.filter(c => c.id !== id));
        return;
      }

      await hdxServer(`connections/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
