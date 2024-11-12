import store from 'store2';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { IS_LOCAL_MODE } from '@/config';

import { testLocalConnection } from './clickhouse';

export type Connection = {
  id: string;
  name: string;
  host: string;
  username: string;
  password: string;
};

export function getLocalConnection(): Connection | undefined {
  return store.session.get('connections')?.[0];
}

export function useConnections() {
  return useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => {
      if (IS_LOCAL_MODE) {
        return store.session.get('connections') ?? [];
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

        const connections = store.session.get('connections') ?? [];
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
        const connections = store.session.get('connections');
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
        const connections = store.session.get('connections');
        delete connections[id];
        store.session.set('connections', connections);

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
