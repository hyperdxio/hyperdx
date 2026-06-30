import { Button, Divider, Stack, Text } from '@mantine/core';

import { ConnectionForm } from '@/components/ConnectionForm';
import { IS_CLICKHOUSE_BUILD } from '@/config';
import { useConnections } from '@/connection';
import { useAutoConnectClickHouse, useConnectToDemoServer } from '@/onboarding';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

function defaultHost() {
  if (IS_CLICKHOUSE_BUILD && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:8123';
}

export interface ConnectClickHousePanelProps {
  /** Whether this step is the active (expanded) one; gates auto-connect. */
  active: boolean;
  onConnected?: () => void;
}

export function ConnectClickHousePanel({
  active,
  onConnected,
}: ConnectClickHousePanelProps) {
  const brandName = useBrandDisplayName();
  const { data: connections } = useConnections();

  useAutoConnectClickHouse({ enabled: active, onConnected });
  const { connectToDemoServer, isConnecting } = useConnectToDemoServer({
    brandName,
    onSuccess: onConnected,
  });

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Connect to your ClickHouse server to start querying telemetry.
      </Text>
      {connections != null ? (
        connections.length === 0 ? (
          <ConnectionForm
            connection={{
              id: '',
              name: 'Default',
              host: defaultHost(),
              username: 'default',
              password: '',
            }}
            isNew
            onSave={onConnected}
          />
        ) : (
          <ConnectionForm
            connection={connections[0]}
            isNew={false}
            onSave={onConnected}
            showCancelButton={false}
            showDeleteButton={false}
          />
        )
      ) : null}
      {!IS_CLICKHOUSE_BUILD ? (
        <>
          <Divider label="OR" />
          <Button
            data-testid="demo-server-button"
            variant="secondary"
            w="100%"
            onClick={connectToDemoServer}
            loading={isConnecting}
          >
            Connect to Demo Server
          </Button>
        </>
      ) : null}
    </Stack>
  );
}

export default ConnectClickHousePanel;
