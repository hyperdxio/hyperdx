import { useEffect } from 'react';
import { Box, Modal } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';

export default function FullscreenPanelModal({
  opened,
  onClose,
  title,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  // YouTube-style 'f' key to toggle fullscreen
  useHotkeys([['f', () => opened && onClose()]], [opened, onClose]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      fullScreen
      transitionProps={{ transition: 'fade', duration: 200 }}
      styles={{
        body: {
          height: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
        content: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        },
        inner: {
          padding: 0,
        },
      }}
      withinPortal
      trapFocus={false}
      lockScroll
    >
      <Box
        h="100%"
        w="100%"
        p="md"
        style={{
          overflow: 'auto',
          position: 'relative',
        }}
      >
        {children}
      </Box>
    </Modal>
  );
}
