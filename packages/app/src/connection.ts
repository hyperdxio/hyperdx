import store from 'store2';
import { testLocalConnection } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Connection } from '@hyperdx/common-utils/dist/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { HDX_LOCAL_DEFAULT_CONNECTIONS, IS_LOCAL_MODE } from '@/config';
import { parseJSON } from '@/utils';

export const LOCAL_STORE_CONNECTIONS_KEY = 'connections';

function setLocalConnections(newConnections: Connection[]) {
  // sessing sessionStorage doesn't send a storage event to the open tab, only
  // another tab. Let's send one anyways for any listeners in other components
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
  // pull sources from env var
  try {
    const defaultConnections = parseJSON(HDX_LOCAL_DEFAULT_CONNECTIONS ?? '');
    if (defaultConnections != null) {
      return defaultConnections;
    }
  } catch (e) {
    console.error('Error fetching default connections', e);
  }
  // fallback to empty array
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

        // id key in local connection and return value
        const createdConnection = { id: 'local' };

        // should be only one connection
        setLocalConnections([
          {
            ...connection,
            ...createdConnection,
          },
        ]);
        return createdConnection;
      }

      const res = await hdxServer('connections', {
        method: 'POST',
        json: connection,
      }).json<{ id: string }>();

      return res;
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
        // should be only one connection
        setLocalConnections([
          {
            ...connection,
            id: 'local',
          },
        ]);

        return;
      }

      await hdxServer(`connections/${id}`, {
        method: 'PUT',
        json: connection,
      });

      return;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
    }: {
      id: string; // Ignored for local
    }) => {
      if (IS_LOCAL_MODE) {
        const connections = getLocalConnections();
        const newConnections = connections.filter(
          connection => connection.id !== id,
        );
        setLocalConnections(newConnections);

        return;
      }

      await hdxServer(`connections/${id}`, {
        method: 'DELETE',
      });

      return;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
