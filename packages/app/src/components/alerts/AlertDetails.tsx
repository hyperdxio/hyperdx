import * as React from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { AlertSource, AlertState } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Collapse,
  Flex,
  Group,
  Stack,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChartLine,
  IconChevronDown,
  IconChevronRight,
  IconHelpCircle,
  IconNote,
  IconTableRow,
} from '@tabler/icons-react';

import { AckAlert } from '@/components/alerts/AckAlert';
import { AlertHistoryCardList } from '@/components/alerts/AlertHistoryCards';
import { AlertPropertiesSummary } from '@/components/alerts/AlertPropertiesSummary';
import { AlertRowMenu } from '@/components/alerts/AlertRowMenu';
import { IS_ALERT_DETAILS_ENABLED } from '@/config';
import type { AlertsPageItem } from '@/types';
import {
  getAlertDisplayName,
  getAlertSourceUrl,
  getAlertTags,
} from '@/utils/alerts';

import styles from '@styles/AlertsPage.module.scss';

/**
 * Minimum width held for the acknowledgement control, sized to its widest
 * state (the "Ack'd" button, which carries a bell icon). A minimum rather than
 * a fixed width so a longer label grows the slot instead of being clipped.
 */
const ACK_SLOT_WIDTH = 84;

export function AlertNote({ note }: { note: string }) {
  const [opened, { toggle }] = useDisclosure(false);

  return (
    <div>
      <UnstyledButton data-testid="alert-note-section" onClick={toggle} mt={4}>
        <Group gap={4}>
          <IconChevronDown
            size={12}
            style={{
              transform: opened ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 200ms',
            }}
          />
          <IconNote size={14} opacity={0.5} />
          <span className="fs-8" style={{ opacity: 0.6 }}>
            Note
          </span>
        </Group>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <div
          className="hdx-markdown fs-8 mt-1"
          style={{ opacity: 0.8, paddingLeft: 20 }}
          data-testid="alert-note-content"
        >
          {opened && (
            <ReactMarkdown
              components={{
                a: props => (
                  <a
                    {...props}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  />
                ),
                img: props => (
                  <img {...props} referrerPolicy="no-referrer" loading="lazy" />
                ),
              }}
            >
              {note}
            </ReactMarkdown>
          )}
        </div>
      </Collapse>
    </div>
  );
}

export const AlertDetails = React.memo(function AlertDetails({
  alert,
}: {
  alert: AlertsPageItem;
}) {
  const alertName = React.useMemo(() => {
    if (alert.source === AlertSource.TILE && alert.dashboard) {
      const tile = alert.dashboard?.tiles.find(
        tile => tile.id === alert.tileId,
      );
      const tileName = tile?.config.name || 'Tile';
      return (
        <>
          {alert.dashboard?.name}
          {tileName ? (
            <>
              <IconChevronRight size={14} className="mx-1" />
              {tileName}
            </>
          ) : null}
        </>
      );
    }
    if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
      return alert.savedSearch?.name;
    }
    return '–';
  }, [alert]);

  const alertUrl = React.useMemo(() => getAlertSourceUrl(alert), [alert]);

  const alertIcon = (() => {
    switch (alert.source) {
      case AlertSource.TILE:
        return <IconChartLine size={14} />;
      case AlertSource.SAVED_SEARCH:
        return <IconTableRow size={14} />;
      default:
        return <IconHelpCircle size={14} />;
    }
  })();

  const linkTitle = React.useMemo(() => {
    switch (alert.source) {
      case AlertSource.TILE:
        return 'Dashboard tile';
      case AlertSource.SAVED_SEARCH:
        return 'Saved search';
      default:
        return '';
    }
  }, [alert]);

  return (
    <div data-testid={`alert-card-${alert._id}`} className={styles.alertRow}>
      <Group>
        {alert.state === AlertState.ALERT && (
          <Badge variant="light" color="red">
            Alert
          </Badge>
        )}
        {alert.state === AlertState.PENDING && (
          <Badge variant="light" color="orange">
            Pending
          </Badge>
        )}
        {alert.state === AlertState.OK && <Badge variant="light">Ok</Badge>}
        {alert.state === AlertState.DISABLED && (
          <Badge variant="light" color="gray">
            Disabled
          </Badge>
        )}

        <Stack gap={2}>
          <div>
            {/* With alert details enabled, the alert name is the entry point
                to its status page; the source tile / saved search moves to a
                secondary link on the right. */}
            <Link
              data-testid={`alert-link-${alert._id}`}
              href={
                IS_ALERT_DETAILS_ENABLED ? `/alerts/${alert._id}` : alertUrl
              }
              className={styles.alertLink}
              title={IS_ALERT_DETAILS_ENABLED ? 'Alert details' : linkTitle}
            >
              <Group gap={2}>
                {alertIcon}
                {alertName}
              </Group>
            </Link>
          </div>
          <AlertPropertiesSummary alert={alert} />
          {getAlertTags(alert).length > 0 && (
            <Group gap={4}>
              {getAlertTags(alert).map(tag => (
                <Badge key={tag} variant="light" color="gray" size="xs">
                  {tag}
                </Badge>
              ))}
            </Group>
          )}
          {alert.note && <AlertNote note={alert.note} />}
        </Stack>
      </Group>

      <Group gap="xs" wrap="nowrap">
        <AlertHistoryCardList alert={alert} alertUrl={alertUrl} />
        {/* Reserved width: AckAlert renders nothing for an OK alert that has
            never been acknowledged, and letting that gap close shifted every
            control to its left, so no two rows lined up. */}
        <Flex miw={ACK_SLOT_WIDTH} justify="flex-end">
          <AckAlert alert={alert} />
        </Flex>
        <AlertRowMenu
          alert={alert}
          alertUrl={IS_ALERT_DETAILS_ENABLED ? alertUrl : undefined}
          linkTitle={linkTitle}
          alertName={getAlertDisplayName(alert)}
        />
      </Group>
    </div>
  );
});
