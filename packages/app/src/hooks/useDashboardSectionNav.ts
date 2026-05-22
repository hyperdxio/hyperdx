import { useCallback } from 'react';
import produce from 'immer';
import { notifications } from '@mantine/notifications';

import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';

type SectionNavContainer = { id: string };

type UrlIdsSetter = (
  updater: string[] | null | ((prev: string[] | null) => string[] | null),
) => void;

/**
 * Navigation API for dashboard containers ("sections"):
 * - `scrollToContainer` — ensures the container is expanded, then smooth-scrolls
 *   the page so the container's header is visible.
 * - `collapseAll` / `expandAll` — batch-set the URL-synced collapse state so the
 *   user can toggle the entire dashboard into a compact menu or back.
 * - `copySectionLink` — writes a shareable `#container-<id>` deep link to the
 *   clipboard and surfaces a confirmation notification.
 *
 * The collapse-state setters are passed in from the caller rather than
 * subscribed to internally so that there is exactly one `useQueryState`
 * subscriber per URL param across the dashboard page (DBDashboardPage owns
 * the canonical subscription). This avoids any subtle interaction between
 * multiple subscribers that could affect router hydration on the saved
 * dashboard page.
 */
export function useDashboardSectionNav({
  containers,
  setUrlCollapsedIds,
  setUrlExpandedIds,
}: {
  containers: SectionNavContainer[];
  setUrlCollapsedIds: UrlIdsSetter;
  setUrlExpandedIds: UrlIdsSetter;
}) {
  const expandContainer = useCallback(
    (containerId: string) => {
      setUrlExpandedIds(prev =>
        produce(prev ?? [], draft => {
          if (!draft.includes(containerId)) draft.push(containerId);
        }),
      );
      setUrlCollapsedIds(prev => {
        const next = (prev ?? []).filter(id => id !== containerId);
        return next.length > 0 ? next : null;
      });
    },
    [setUrlCollapsedIds, setUrlExpandedIds],
  );

  const scrollToContainer = useCallback(
    (containerId: string) => {
      expandContainer(containerId);
      // Double-rAF before scrolling: the first frame lets nuqs flush the URL
      // setter and React commit the un-collapse; the second frame lets the
      // newly-mounted tile grid lay out, so the container header position is
      // stable when scrollIntoView measures it. A single rAF is too early when
      // the section starts collapsed and the children have to mount.
      if (typeof window === 'undefined') return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          document
            .getElementById(`container-${containerId}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    },
    [expandContainer],
  );

  const collapseAll = useCallback(() => {
    const ids = containers.map(c => c.id);
    setUrlCollapsedIds(ids.length > 0 ? ids : null);
    setUrlExpandedIds(null);
  }, [containers, setUrlCollapsedIds, setUrlExpandedIds]);

  const expandAll = useCallback(() => {
    const ids = containers.map(c => c.id);
    setUrlExpandedIds(ids.length > 0 ? ids : null);
    setUrlCollapsedIds(null);
  }, [containers, setUrlCollapsedIds, setUrlExpandedIds]);

  const copySectionLink = useCallback(async (containerId: string) => {
    if (typeof window === 'undefined') return;
    const { origin, pathname, search } = window.location;
    const url = `${origin}${pathname}${search}#container-${containerId}`;
    const copied = await copyTextToClipboard(url);
    if (!copied) {
      notifications.show({
        color: 'red',
        title: 'Could not copy link',
        message: CLIPBOARD_ERROR_MESSAGE,
        autoClose: 4000,
      });
      return;
    }
    notifications.show({
      color: 'green',
      title: 'Link copied',
      message: 'Section link copied to clipboard.',
      autoClose: 2000,
    });
  }, []);

  return {
    scrollToContainer,
    collapseAll,
    expandAll,
    copySectionLink,
  };
}
