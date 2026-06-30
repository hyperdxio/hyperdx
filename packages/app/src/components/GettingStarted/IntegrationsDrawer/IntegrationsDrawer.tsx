import { Box, Drawer, Group, Stack, Text } from '@mantine/core';

import { INTEGRATION_CATEGORIES } from '../integrationsCatalog';

import { DrawerContent } from './DrawerContent';

export interface IntegrationsDrawerProps {
  opened: boolean;
  onClose: () => void;
  endpoint: string;
  apiKey: string;
  /** Category chip selected when the drawer opens. */
  initialCategory?: string;
}

const TOTAL_COUNT = INTEGRATION_CATEGORIES.reduce(
  (sum, c) => sum + c.items.length,
  0,
);

export function IntegrationsDrawer({
  opened,
  onClose,
  endpoint,
  apiKey,
  initialCategory = 'all',
}: IntegrationsDrawerProps) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={640}
      title={
        <Stack gap={2}>
          <Group gap={8} align="center">
            <Text fw={700} fz={18} style={{ color: 'var(--color-text)' }}>
              Send data to ClickStack
            </Text>
            <Box
              px={8}
              style={{
                borderRadius: 999,
                background: 'var(--color-bg-muted)',
              }}
            >
              <Text fz={12} fw={600} style={{ color: 'var(--color-text)' }}>
                {TOTAL_COUNT}
              </Text>
            </Box>
          </Group>
          <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
            Pick a language, framework, or platform to get a setup guide.
          </Text>
        </Stack>
      }
    >
      <DrawerContent
        endpoint={endpoint}
        apiKey={apiKey}
        initialCategory={initialCategory}
      />
    </Drawer>
  );
}
