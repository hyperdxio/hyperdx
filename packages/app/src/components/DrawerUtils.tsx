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

const LARGE_SCREEN_BREAKPOINT_PX = 1440;
const LARGE_SCREEN_DRAWER_WIDTH_PERCENT = 60;
const SMALL_SCREEN_DRAWER_WIDTH_PERCENT = 80;

export function getInitialDrawerWidthPercent(): number {
  if (typeof window === 'undefined') {
    return SMALL_SCREEN_DRAWER_WIDTH_PERCENT;
  }

  if (window.innerWidth > LARGE_SCREEN_BREAKPOINT_PX) {
    return LARGE_SCREEN_DRAWER_WIDTH_PERCENT;
  }

  return SMALL_SCREEN_DRAWER_WIDTH_PERCENT;
}

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
