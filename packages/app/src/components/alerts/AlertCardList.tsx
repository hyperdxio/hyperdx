import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import { Group } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBell,
  IconCheck,
  IconHourglass,
} from '@tabler/icons-react';

import { AlertDetails } from '@/components/alerts/AlertDetails';
import EmptyState from '@/components/EmptyState';
import { useVirtualList } from '@/hooks/useVirtualList';
import { APP_CONTENT_SCROLL_CONTAINER_ID } from '@/layout';
import type { AlertsPageItem } from '@/types';

import styles from '@styles/AlertsPage.module.scss';

/**
 * Space above a section header. `.sectionHeader`'s own `margin-top` plus the
 * `gap-4` (--mantine-spacing-lg, 20px) the sections used to sit in, applied as
 * padding on the measured wrapper: the virtualizer measures bounding rects,
 * which exclude margins.
 */
const FIRST_HEADER_SPACING = 30;
const HEADER_SPACING = 50;

/**
 * Heights assumed until an item is measured. Every correction shifts the items
 * below it, so a per-item estimate rather than one average keeps the list from
 * visibly wobbling as it is scrolled. Measured in the browser: a row is 66px,
 * tag badges add 18px and the note toggle 27px, and a section header is 63px
 * over its spacing above.
 */
const ROW_HEIGHT = 66;
const TAGS_HEIGHT = 18;
const NOTE_TOGGLE_HEIGHT = 27;
/** `.sectionHeader` text plus its padding-bottom and border. */
const HEADER_HEIGHT = 33;
/**
 * `EmptyState variant="card"`: `p="xl"` (32px) around a `mih={100}` centre,
 * plus the border. Arithmetic rather than measured — it renders at most once,
 * so its error cannot accumulate down the list.
 */
const OK_EMPTY_HEIGHT = 166;

function estimateItemHeight(item: AlertListItem): number {
  switch (item.type) {
    case 'header':
      return (
        (item.isFirst ? FIRST_HEADER_SPACING : HEADER_SPACING) + HEADER_HEIGHT
      );
    case 'okEmpty':
      return OK_EMPTY_HEIGHT;
    default:
      return (
        ROW_HEIGHT +
        (item.alert.tags?.length > 0 ? TAGS_HEIGHT : 0) +
        (item.alert.note ? NOTE_TOGGLE_HEIGHT : 0)
      );
  }
}

type SectionKind = 'triggered' | 'pending' | 'ok';

type AlertListItem =
  | { type: 'header'; key: string; section: SectionKind; isFirst: boolean }
  | { type: 'alert'; key: string; alert: AlertsPageItem }
  | { type: 'okEmpty'; key: string };

const SECTIONS: Record<
  SectionKind,
  { label: string; icon: React.ReactNode; state: AlertState }
> = {
  triggered: {
    label: 'Triggered',
    icon: <IconAlertTriangle size={14} />,
    state: AlertState.ALERT,
  },
  pending: {
    label: 'Pending',
    icon: <IconHourglass size={14} />,
    state: AlertState.PENDING,
  },
  ok: {
    label: 'OK',
    icon: <IconCheck size={14} />,
    state: AlertState.OK,
  },
};

/** Items in the list include alerts and alert state section headers (eg. 'Triggered') */
function buildItems(alerts: AlertsPageItem[]): AlertListItem[] {
  const items: AlertListItem[] = [];

  // Alerts in the DISABLED and ERROR states belong to none of the three
  // sections and are not listed
  const pushSection = (section: SectionKind) => {
    const sectionAlerts = alerts.filter(
      alert => alert.state === SECTIONS[section].state,
    );
    if (section !== 'ok' && sectionAlerts.length === 0) return;

    items.push({
      type: 'header',
      key: `header-${section}`,
      section,
      isFirst: items.length === 0,
    });
    if (section === 'ok' && sectionAlerts.length === 0) {
      items.push({ type: 'okEmpty', key: 'ok-empty' });
      return;
    }
    sectionAlerts.forEach(alert =>
      items.push({ type: 'alert', key: alert._id, alert }),
    );
  };

  pushSection('triggered');
  pushSection('pending');
  pushSection('ok');

  return items;
}

/**
 * Measures how far the list sits below the top of the scroll container's
 * content, which the virtualizer needs to map scroll offsets onto item
 * offsets. Adding `scrollTop` makes the result independent of where the page
 * happens to be scrolled to.
 */
function useScrollMargin(listRef: React.RefObject<HTMLDivElement | null>) {
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const scroller = document.getElementById(APP_CONTENT_SCROLL_CONTAINER_ID);
    const list = listRef.current;
    if (!scroller || !list) return;

    const measure = () => {
      const offset =
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setScrollMargin(prev => (prev === offset ? prev : offset));
    };

    measure();

    // The scroller catches viewport resizes; the list's parent catches the
    // filter row and info banner changing height above it.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (list.parentElement) observer.observe(list.parentElement);
    return () => observer.disconnect();
  }, [listRef]);

  return scrollMargin;
}

export function AlertCardList({ alerts }: { alerts: AlertsPageItem[] }) {
  const items = useMemo(() => buildItems(alerts), [alerts]);

  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(listRef);

  const estimateSize = useCallback(
    (index: number) => estimateItemHeight(items[index]),
    [items],
  );

  const { rowVirtualizer, virtualItems, paddingTop, paddingBottom } =
    useVirtualList(items.length, estimateSize, 10, {
      getScrollElement: () =>
        document.getElementById(APP_CONTENT_SCROLL_CONTAINER_ID),
      scrollMargin,
      getItemKey: useCallback(index => items[index].key, [items]),
    });

  return (
    <div ref={listRef}>
      {paddingTop > 0 && <div style={{ height: paddingTop }} />}
      {virtualItems.map(virtualRow => {
        const item = items[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
          >
            {item.type === 'header' ? (
              <div
                style={{
                  paddingTop: item.isFirst
                    ? FIRST_HEADER_SPACING
                    : HEADER_SPACING,
                }}
              >
                <Group
                  className={styles.sectionHeader}
                  style={{ marginTop: 0 }}
                >
                  {SECTIONS[item.section].icon} {SECTIONS[item.section].label}
                </Group>
              </div>
            ) : item.type === 'alert' ? (
              <AlertDetails alert={item.alert} />
            ) : (
              <EmptyState
                variant="card"
                icon={<IconBell size={32} />}
                title="No alerts"
                description="All alerts in OK state will appear here."
              />
            )}
          </div>
        );
      })}
      {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
    </div>
  );
}
