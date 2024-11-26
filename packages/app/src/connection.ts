import store from 'store2';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer, nextServer } from '@/api';
import { testLocalConnection } from '@/clickhouse';
import { IS_LOCAL_MODE } from '@/config';
import type { NextApiConfigResponseData } from '@/types';
import { parseJSON } from '@/utils';

export type Connection = {
  id: string;
  name: string;
  host: string;
  username: string;
  password: string;
};

export async function getLocalConnections(): Promise<Connection[]> {
  if (store.has('connections')) {
    return store.session.get('connections') ?? [];
  }
  // pull sources from env var
  const respData: NextApiConfigResponseData =
    await nextServer('api/config').json();
  if (respData?.defaultConnections) {
    const defaultConnections = parseJSON(respData.defaultConnections);
    store.session.set('connections', defaultConnections);
    return defaultConnections;
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

        const connections = await getLocalConnections();
        connections[0] = {
          ...connection,
          id: 'local',
        };
        store.session.set('connections', connections);

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
        const connections = await getLocalConnections();
        connections[0] = {
          ...connection,
          id: 'local',
        };
        store.session.set('connections', connections);

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
        const connections = await getLocalConnections();
        const newConnections = connections.filter(
          connection => connection.id !== id,
        );
        store.session.set('connections', newConnections);

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
