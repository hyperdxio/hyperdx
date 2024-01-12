import * as React from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Box, CloseButton, Group, Text } from '@mantine/core';

export const DrawerHeader = React.memo<{
  header?: React.ReactNode;
  onClose?: () => void;
  closeEsc?: boolean;
}>(({ header, onClose, closeEsc = true }) => {
  useHotkeys(['esc'], () => onClose?.(), { enabled: closeEsc });

  return (
    <Box px="md" py="xs" className="border-bottom border-dark">
      <Group position="apart" align="center">
        <Text size="md">{header}</Text>
        <CloseButton
          onClick={onClose}
          aria-label="Close modal"
          variant="light"
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
