import { ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  ScrollArea,
  Text,
  Tooltip,
} from '@mantine/core';
import { useId } from '@mantine/hooks';
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
  // The docked panel replaces a Mantine Drawer, which exposed role="dialog"
  // with an accessible name. Preserve an accessible landmark: a labelled
  // region whose name comes from the heading title.
  const titleId = useId();
  return (
    <Box
      data-testid={dataTestId}
      role="region"
      aria-labelledby={titleId}
      style={{
        flexShrink: 0,
        // Cap at 340px but yield to the editor column on narrow viewports (the
        // panel lives inside a 90% drawer), so the editor is never crushed.
        width: 'min(340px, 45%)',
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
        <Text id={titleId} component="h2" size="sm" fw={600} m={0}>
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
