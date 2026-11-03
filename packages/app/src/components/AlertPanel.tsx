import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Box, type BoxProps, Flex } from '@mantine/core';

import useResizable from '@/hooks/useResizable';

import resizeStyles from '@styles/ResizablePanel.module.scss';

// Widths as percentages of the window, the unit useResizable drags in.
const DEFAULT_PANEL_WIDTH_PERCENT = 33;
// Wider than this squeezes the editor beside it past usable, inside a modal
// that is itself narrower than the window.
const MAX_PANEL_WIDTH_PERCENT = 50;
// The alert form's inline trigger row stops fitting below this.
const MIN_PANEL_WIDTH = 360;
const PANEL_BOTTOM_GAP = 12;
const MIN_PANEL_HEIGHT = 320;

/** The nearest ancestor that scrolls its content, or null for the document. */
function getScrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node != null) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * The height the scroll area shows once its content fills it. A centered
 * modal grows with its content up to a max height, so its current height is
 * no guide: sizing the panel to it would shrink the modal, and then the panel,
 * on every resize.
 */
function getVisibleHeight(scrollParent: HTMLElement | null): number {
  if (scrollParent == null) {
    return window.innerHeight;
  }
  const maxHeight = parseFloat(getComputedStyle(scrollParent).maxHeight);
  return Number.isFinite(maxHeight)
    ? Math.min(maxHeight, window.innerHeight)
    : scrollParent.clientHeight;
}

/**
 * Pins the panel where the layout starts within the area that scrolls it, and
 * sizes it to the rest of that area. Measured rather than derived from the
 * viewport: a centered modal's scroll area is a fraction of the viewport, and
 * pages and titled modals have chrome above the editor, so any fixed offset
 * leaves the footer off screen somewhere.
 */
function usePanelBounds(root: HTMLElement | null, enabled: boolean) {
  const [bounds, setBounds] = useState<{ top: number; height: number }>();

  useLayoutEffect(() => {
    if (root == null || !enabled) return;
    const scrollParent = getScrollParent(root);

    const measure = () => {
      const top =
        scrollParent != null
          ? root.getBoundingClientRect().top -
            scrollParent.getBoundingClientRect().top -
            scrollParent.clientTop +
            scrollParent.scrollTop
          : root.getBoundingClientRect().top + window.scrollY;
      const next = {
        top: Math.max(0, Math.round(top)),
        height: Math.max(
          MIN_PANEL_HEIGHT,
          Math.round(getVisibleHeight(scrollParent) - top - PANEL_BOTTOM_GAP),
        ),
      };
      setBounds(prev =>
        prev?.top === next.top && prev.height === next.height ? prev : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollParent ?? document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [root, enabled]);

  return bounds;
}

/**
 * A docked side panel for the chart editor's alert settings, so the preview
 * chart stays in view while the alert is tuned against it.
 *
 * The alert editor is rendered by whichever editor mode is active (builder or
 * SQL), each with its own warnings and errors, so it portals itself into the
 * panel rather than being rendered by the layout. The panel only opens while
 * an alert editor is mounted to fill it.
 *
 * Changes made in the panel are kept by confirming them with the panel's
 * action; closing the panel instead cancels them. For a newly added alert (a
 * draft) that discards the alert; for an existing one it reverts the edits.
 * Either way the preview reflects the edits live while the panel is open.
 */
const AlertPanelContext = createContext<
  | {
      opened: boolean;
      setOpened: (opened: boolean) => void;
      isDraft: boolean;
      setIsDraft: (isDraft: boolean) => void;
      onOpen?: () => void;
      onCancel?: (isDraft: boolean) => void;
      actions?: ReactNode;
      target: HTMLElement | null;
      setTarget: (target: HTMLElement | null) => void;
      setHasContent: (hasContent: boolean) => void;
    }
  | undefined
>(undefined);

/** Lays out its children beside the alert panel. */
export function AlertPanelLayout({
  defaultOpened = false,
  actions,
  onOpen,
  onCancel,
  children,
  ...props
}: BoxProps & {
  defaultOpened?: boolean;
  /**
   * The alert's primary action. The alert form places it under its inputs
   * with `AlertPanelActions`, so it reads as part of the alert rather than
   * the whole editor.
   */
  actions?: ReactNode;
  /** Called when the panel opens on an existing alert, before any edits. */
  onOpen?: () => void;
  /** Undoes the panel's changes when it is closed without confirming them. */
  onCancel?: (isDraft: boolean) => void;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(defaultOpened);
  const [isDraft, setIsDraft] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const showPanel = opened && hasContent;
  const bounds = usePanelBounds(root, showPanel);
  // The handle sits on the panel's left edge, so dragging left widens it.
  const { size: widthPercent, startResize } = useResizable(
    DEFAULT_PANEL_WIDTH_PERCENT,
    'right',
    {
      minPercent:
        typeof window === 'undefined'
          ? undefined
          : (MIN_PANEL_WIDTH / window.innerWidth) * 100,
      maxPercent: MAX_PANEL_WIDTH_PERCENT,
    },
  );
  const value = useMemo(
    () => ({
      opened,
      setOpened,
      isDraft,
      setIsDraft,
      onOpen,
      onCancel,
      actions,
      target,
      setTarget,
      setHasContent,
    }),
    [opened, isDraft, onOpen, onCancel, actions, target],
  );

  return (
    <AlertPanelContext value={value}>
      <Flex ref={setRoot} align="flex-start" gap="md" {...props}>
        <Box flex={1} miw={0}>
          {children}
        </Box>
        {showPanel && (
          <Box
            component="aside"
            data-testid="alert-panel"
            style={{
              flexShrink: 0,
              width: `${widthPercent}vw`,
              minWidth: MIN_PANEL_WIDTH,
              // Stays in view while the editor and preview scroll beside it.
              position: 'sticky',
              top: bounds?.top ?? 0,
              height: bounds?.height ?? `${MIN_PANEL_HEIGHT}px`,
              borderLeft: '1px solid var(--color-border)',
            }}
          >
            <div
              className={resizeStyles.resizeHandle}
              style={{ left: 0, right: 'auto' }}
              onMouseDown={startResize}
              data-testid="alert-panel-resize-handle"
            />
            <Box
              ref={setTarget}
              h="100%"
              pl="md"
              style={{ overflowY: 'auto' }}
            />
          </Box>
        )}
      </Flex>
    </AlertPanelContext>
  );
}

/** Controls the alert panel. Undefined outside an `AlertPanelLayout`. */
export function useAlertPanel() {
  const context = use(AlertPanelContext);
  const setOpened = context?.setOpened;
  const setIsDraft = context?.setIsDraft;
  const opened = context?.opened ?? false;
  const isDraft = context?.isDraft ?? false;
  const onOpen = context?.onOpen;
  const onCancel = context?.onCancel;

  /** Opens the panel on the chart's existing alert. */
  const open = useCallback(() => {
    if (!opened) {
      onOpen?.();
    }
    setOpened?.(true);
  }, [onOpen, opened, setOpened]);
  /** Opens the panel on an alert that was just added. */
  const openDraft = useCallback(() => {
    setIsDraft?.(true);
    setOpened?.(true);
  }, [setIsDraft, setOpened]);
  /** Keeps the panel's changes and closes it. */
  const confirm = useCallback(() => {
    setIsDraft?.(false);
    setOpened?.(false);
  }, [setIsDraft, setOpened]);
  /** Closes the panel, cancelling its changes. */
  const close = useCallback(() => {
    onCancel?.(isDraft);
    setIsDraft?.(false);
    setOpened?.(false);
  }, [isDraft, onCancel, setIsDraft, setOpened]);

  if (context == null) return undefined;
  return { opened, isDraft, open, openDraft, confirm, close };
}

/**
 * Renders its children in the alert panel: nothing while the panel is closed,
 * and in place when there is no panel at all.
 */
export function AlertPanelFill({ children }: { children: ReactNode }) {
  const context = use(AlertPanelContext);
  const setHasContent = context?.setHasContent;

  // A layout effect lets the panel open in the same frame the content mounts.
  useLayoutEffect(() => {
    setHasContent?.(true);
    return () => setHasContent?.(false);
  }, [setHasContent]);

  if (context == null) return children;
  return context.target ? createPortal(children, context.target) : null;
}

/** Renders the alert panel's primary action, if it has one. */
export function AlertPanelActions() {
  return use(AlertPanelContext)?.actions ?? null;
}
