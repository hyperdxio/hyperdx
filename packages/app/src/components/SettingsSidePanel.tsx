import { ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  ScrollArea,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';

/**
 * Shared chrome for a docked, full-height settings side panel used inside the
 * tile editor drawer (in place of a nested Drawer). A pinned header with a
 * close button sits on top; only the body scrolls (vertical only). The
 * `border-left` runs the full height so it meets the editor's header underline.
 */
export default function SettingsSidePanel({
  title,
  onClose,
  children,
  'data-testid': dataTestId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <Box
      data-testid={dataTestId}
      style={{
        flexShrink: 0,
        width: 340,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--color-border)',
      }}
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        px="md"
        py="sm"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Tooltip label="Close" position="bottom">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onClose}
            aria-label={`Close ${title}`}
            data-testid="settings-panel-close-button"
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <ScrollArea
        scrollbars="y"
        style={{ flex: 1, minHeight: 0 }}
        px="md"
        py="md"
      >
        {children}
      </ScrollArea>
    </Box>
  );
}
