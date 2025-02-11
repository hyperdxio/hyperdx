import { useCallback, useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';

import api from '@/api';
import { Connection, useConnections } from '@/connection';

const INITIAL_DELAY = 5000;
const CHECK_INTERVAL = 5 * 60 * 1000;
const RETRY_DELAY = 15 * 1000;

export function useConnectionHealth() {
  const { data: connections } = useConnections();
  const testConnection = api.useTestConnection();
  const [failedConnections, setFailedConnections] = useState<
    Map<string, number>
  >(new Map());
  const [isChecking, setIsChecking] = useState(false);

  /* Simple function for showing notifications */
  const showNotification = useCallback(
    (
      connectionId: string,
      connectionName: string,
      isError: boolean,
      message?: string,
    ) => {
      notifications.show({
        id: `connection-${isError ? 'error' : 'restored'}-${connectionId}`,
        color: isError ? 'red' : 'green',
        message: isError
          ? `Connection "${connectionName}" is not responding: ${message}`
          : `Connection "${connectionName}" has been restored`,
        autoClose: isError ? false : 5000,
      });
    },
    [],
  );

  /* Maintains a map of connection IDs to their last failed check timestamp */
  const updateFailedConnections = useCallback(
    (connectionId: string, shouldAdd: boolean, timestamp?: number) => {
      setFailedConnections(prev => {
        const next = new Map(prev);
        if (shouldAdd) {
          next.set(connectionId, timestamp || Date.now());
        } else {
          next.delete(connectionId);
        }
        return next;
      });
    },
    [],
  );

  /* Checks if a single connection is failing and shows a notification if it is */
  const checkConnection = useCallback(
    async (connection: Connection) => {
      const now = Date.now();
      const lastCheckTime = failedConnections.get(connection.id) || 0;

      if (now - lastCheckTime < RETRY_DELAY) {
        return;
      }

      try {
        const result = await testConnection.mutateAsync({
          host: connection.host,
          username: connection.username,
          password: connection.password,
        });

        const wasFailedPreviously = failedConnections.has(connection.id);

        if (!result.success) {
          if (!wasFailedPreviously) {
            updateFailedConnections(connection.id, true, now);
            showNotification(
              connection.id,
              connection.name,
              true,
              result.error,
            );
          }
        } else if (wasFailedPreviously) {
          updateFailedConnections(connection.id, false);
          showNotification(connection.id, connection.name, false);
        }
      } catch (error: any) {
        if (!failedConnections.has(connection.id)) {
          const body = await error.response?.json();
          const errorMessage = body?.error ?? error.message;
          updateFailedConnections(connection.id, true, now);
          showNotification(connection.id, connection.name, true, errorMessage);
        }
      }
    },
    [
      testConnection,
      failedConnections,
      updateFailedConnections,
      showNotification,
    ],
  );

  /* Checks all connections and shows notifications if they are failing */
  const checkConnections = useCallback(async () => {
    if (!connections?.length || isChecking) return;
    setIsChecking(true);

    try {
      for (const connection of connections) {
        await checkConnection(connection);
        // Add small delay between checks to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally {
      setIsChecking(false);
    }
  }, [connections, isChecking, checkConnection]);

  /* Sets up the initial check and the interval check */
  useEffect(() => {
    const initialCheckTimeout = setTimeout(checkConnections, INITIAL_DELAY);
    const interval = setInterval(checkConnections, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialCheckTimeout);
      clearInterval(interval);
    };
  }, [checkConnections]);
}
