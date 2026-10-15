import { type ReactNode, useState } from 'react';
import { Drawer } from '@mantine/core';

import { useZIndex } from '@/zIndex';

import { useCompactViewport } from './useCompactViewport';

/**
 * Side panel beside a main pane. On a compact viewport the panel opens in a
 * drawer so it does not take horizontal space from the main pane. The caller
 * owns `opened`; this component does not persist that state.
 */
export function ResponsiveSidePanel({
  panel,
  children,
  opened,
  onClose,
  title,
  className,
}: {
  panel: ReactNode;
  children: ReactNode;
  opened: boolean;
  onClose: () => void;
  title: string;
  className?: string;
}) {
  const isCompact = useCompactViewport();
  const drawerZIndex = useZIndex() + 10;
  // Stay unmounted until the first open, so a phone does not fetch facets
  // before the user asks. After that, keep the panel mounted so closing the
  // drawer does not drop facet state or repeat those queries.
  const [keepPanelMounted, setKeepPanelMounted] = useState(opened);
  if (opened && !keepPanelMounted) {
    setKeepPanelMounted(true);
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {!isCompact && opened ? panel : null}
      {children}
      {isCompact && (
        <Drawer
          opened={opened}
          onClose={onClose}
          position="left"
          title={title}
          size="min(100vw, 360px)"
          zIndex={drawerZIndex}
          keepMounted={keepPanelMounted}
          styles={{
            content: {
              display: 'flex',
              flexDirection: 'column',
            },
            body: {
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
            },
          }}
        >
          {keepPanelMounted ? panel : null}
        </Drawer>
      )}
    </div>
  );
}
