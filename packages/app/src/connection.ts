import store from 'store2';
import { testLocalConnection } from '@hyperdx/common-utils/dist/clickhouse';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { HDX_LOCAL_DEFAULT_CONNECTIONS, IS_LOCAL_MODE } from '@/config';
import { parseJSON } from '@/utils';

const LOCAL_STORE_CONNECTIONS_KEY = 'connections';

export type Connection = {
  id: string;
  name: string;
  host: string;
  username: string;
  password: string;
};

function setLocalConnections(newConnections: Connection[]) {
  store.session.set(LOCAL_STORE_CONNECTIONS_KEY, newConnections);
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

  return useMutation<void, Error, { connection: Connection }>({
    mutationFn: async ({ connection }: { connection: Connection }) => {
      if (IS_LOCAL_MODE) {
        const isValid = await testLocalConnection({
          host: connection.host,
          username: connection.username,
          password: connection.password,
        });

        if (!isValid) {
          throw new Error(
            'Could not connect to Clickhouse with connection details',
          );
        }

        const connections = getLocalConnections();
        connections[0] = {
          ...connection,
          id: 'local',
        };
        setLocalConnections(connections);
        return;
      }

      await hdxServer('connections', {
        method: 'POST',
        json: connection,
      });

      return;
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
        const connections = getLocalConnections();
        connections[0] = {
          ...connection,
          id: 'local',
        };
        setLocalConnections(connections);

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
