import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { IconArrowsMinimize } from '@tabler/icons-react';

import { PageHeader } from '@/components/PageHeader';

export function DashboardKioskHeader({
  dashboardName,
  onExit,
}: {
  dashboardName: string;
  onExit: () => void;
}) {
  return (
    <PageHeader
      data-testid="kiosk-header"
      title={dashboardName || 'Untitled Dashboard'}
      actions={
        <Group gap="md" wrap="nowrap">
          <Group
            gap={6}
            wrap="nowrap"
            data-testid="kiosk-live-status"
            aria-label="Live auto-refresh enabled. Dashboard is read-only."
          >
            <Box
              component="span"
              w={8}
              h={8}
              bg="var(--color-bg-success)"
              style={{ borderRadius: '50%', flexShrink: 0 }}
            />
            <Text size="xs" c="var(--color-text-muted)" visibleFrom="xs">
              Live · Read-only
            </Text>
          </Group>
          <Tooltip label="Exit kiosk mode" withArrow>
            <ActionIcon
              variant="subtle"
              size="input-sm"
              aria-label="Exit kiosk mode"
              data-testid="exit-kiosk-mode-button"
              onClick={onExit}
            >
              <IconArrowsMinimize size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      }
    />
  );
}
