import { useState } from 'react';
import { Box, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { IntegrationsDrawer } from '../IntegrationsDrawer';

import { ConnectionPanel } from './ConnectionPanel';
import { IntegrationsCard } from './IntegrationsCard';

export interface SendTelemetryPanelProps {
  endpoint: string;
  apiKey: string;
  onCheckTelemetry?: () => void;
  isChecking?: boolean;
}

export function SendTelemetryPanel({
  endpoint,
  apiKey,
  onCheckTelemetry,
  isChecking = false,
}: SendTelemetryPanelProps) {
  const [drawerOpened, drawer] = useDisclosure(false);
  const [drawerCategory, setDrawerCategory] = useState('all');

  const openDrawer = (category: string) => {
    setDrawerCategory(category);
    drawer.open();
  };

  return (
    <Stack gap={20}>
      <ConnectionPanel endpoint={endpoint} apiKey={apiKey} />

      <Box style={{ height: 1, background: 'var(--color-border)' }} />

      <IntegrationsCard
        onBrowse={() => openDrawer('all')}
        onLanguageSdks={() => openDrawer('languages')}
      />

      <IntegrationsDrawer
        opened={drawerOpened}
        onClose={drawer.close}
        endpoint={endpoint}
        apiKey={apiKey}
        initialCategory={drawerCategory}
      />

      {onCheckTelemetry ? (
        <Group gap={12} align="center">
          <Button
            variant="secondary"
            size="xs"
            onClick={onCheckTelemetry}
            disabled={isChecking}
            leftSection={isChecking ? <Loader size={12} /> : undefined}
          >
            Check for telemetry
          </Button>
          <Text fz={12} style={{ color: 'var(--color-text-muted)' }}>
            Once data is detected your next steps will be ready to use
          </Text>
        </Group>
      ) : null}
    </Stack>
  );
}
