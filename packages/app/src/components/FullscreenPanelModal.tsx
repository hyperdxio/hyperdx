import { Box, Modal } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';

import { IsolatedChartSyncProvider } from '@/chartSync';
import { useZIndex, ZIndexContext } from '@/zIndex';

export default function FullscreenPanelModal({
  opened,
  onClose,
  title,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  // YouTube-style 'f' key to toggle fullscreen
  useHotkeys([['f', () => opened && onClose()]]);

  // Stack on top of any ancestor drawer/modal (`contextZIndex + 10`) and
  // expose this value via `ZIndexContext` so any drawer/popover opened from
  // inside the fullscreen view (e.g. clicking a row in a search tile) lands
  // above the modal instead of being hidden behind it.
  const contextZIndex = useZIndex();
  const modalZIndex = contextZIndex + 10;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      fullScreen
      transitionProps={{ transition: 'fade', duration: 200 }}
      zIndex={modalZIndex}
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
      <ZIndexContext.Provider value={modalZIndex}>
        {/* Isolate chart cross-syncing to this modal: a chart shown fullscreen
            should not drive shadow tooltips on the dashboard tiles behind it
            (which now render over the modal). */}
        <IsolatedChartSyncProvider>
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
        </IsolatedChartSyncProvider>
      </ZIndexContext.Provider>
    </Modal>
  );
}
