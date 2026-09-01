import * as React from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  ActionIcon,
  Box,
  CloseButton,
  Group,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
} from '@tabler/icons-react';

export const INITIAL_DRAWER_WIDTH_PERCENT = 80;

/**
 * The row panel opens narrower than the session player because its content is
 * mostly short values, and covering the results list breaks the row-to-row
 * scan. A long `Body` wraps at any width, so widening the default does not buy
 * the one case that wants the space.
 */
export const INITIAL_ROW_PANEL_WIDTH_PERCENT = 60;

export const ROW_PANEL_WIDTH_STORAGE_KEY = 'hdx_row_panel_width_percent';

export const DrawerFullWidthToggle = React.memo<{
  isFullWidth?: boolean;
  onToggle: () => void;
}>(({ isFullWidth, onToggle }) => {
  const label = isFullWidth ? 'Collapse panel width' : 'Expand panel width';
  return (
    <Tooltip label={label} position="bottom">
      <ActionIcon
        variant="subtle"
        size="sm"
        onClick={onToggle}
        aria-label={label}
      >
        {isFullWidth ? (
          <IconLayoutSidebarRightCollapse size={16} />
        ) : (
          <IconLayoutSidebarRightExpand size={16} />
        )}
      </ActionIcon>
    </Tooltip>
  );
});

export const DrawerHeader = React.memo<{
  header?: React.ReactNode;
  onClose?: () => void;
  closeEsc?: boolean;
}>(({ header, onClose, closeEsc = true }) => {
  useHotkeys(['esc'], () => onClose?.(), { enabled: closeEsc });

  return (
    <Box px="md" py="xs" className="border-bottom border-dark">
      <Group justify="space-between" align="center">
        <Text size="md">{header}</Text>
        <CloseButton
          onClick={onClose}
          aria-label="Close modal"
          variant="subtle"
          size="md"
        />
      </Group>
    </Box>
  );
});

export const DrawerBody = React.memo<{
  children: React.ReactNode;
}>(({ children }) => {
  return (
    <Box className="w-100 overflow-auto" px="sm" py="md">
      {children}
    </Box>
  );
});
