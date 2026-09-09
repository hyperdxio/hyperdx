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
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChartDots,
  IconChartLine,
  IconChevronDown,
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
import { getAlertSourceLabel, getAlertSourceUrl } from '@/utils/alerts';

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
  const alertName = alert.displayName || '–';

  const alertUrl = React.useMemo(() => getAlertSourceUrl(alert), [alert]);

  const sourceLabel = getAlertSourceLabel(alert);

  // The glyph alone doesn't say what it watches; the tooltip (and its
  // accessible label) names it. `span` wrapper: Tooltip needs an element that
  // forwards a ref, which the icon components don't.
  const sourceGlyph = (() => {
    switch (alert.source) {
      case AlertSource.TILE:
        return <IconChartLine size={14} aria-hidden="true" />;
      case AlertSource.SAVED_SEARCH:
        return <IconTableRow size={14} aria-hidden="true" />;
      case AlertSource.INLINE:
        // Matches the chart explorer's nav icon: an inline alert's query is
        // authored and reopened there.
        return <IconChartDots size={14} aria-hidden="true" />;
      default:
        return <IconHelpCircle size={14} aria-hidden="true" />;
    }
  })();

  // Only labelled when the source actually resolves — same guard as
  // `linkTitle`, so an alert whose source is gone doesn't get a confident
  // "Unknown source" tooltip where the rest of the row stays silent.
  const alertIcon = alert.source ? (
    <Tooltip label={sourceLabel} withArrow position="top">
      <span
        role="img"
        aria-label={sourceLabel}
        style={{ display: 'inline-flex' }}
        data-testid={`alert-source-icon-${alert._id}`}
      >
        {sourceGlyph}
      </span>
    </Tooltip>
  ) : (
    <span
      style={{ display: 'inline-flex' }}
      data-testid={`alert-source-icon-${alert._id}`}
    >
      {sourceGlyph}
    </span>
  );

  // Empty for an unresolvable source: AlertRowMenu lowercases this into
  // "Open <source>" and falls back to its own wording when blank.
  const linkTitle = alert.source ? sourceLabel : '';

  const nameHref = IS_ALERT_DETAILS_ENABLED
    ? `/alerts/${alert._id}`
    : alertUrl || undefined;

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
                secondary link on the right. An alert whose source cannot be
                resolved — a deleted dashboard, say — has no destination at
                all, so its name is plain text rather than a link to nowhere. */}
            {nameHref ? (
              <Link
                data-testid={`alert-link-${alert._id}`}
                href={nameHref}
                className={styles.alertLink}
                title={IS_ALERT_DETAILS_ENABLED ? 'Alert details' : linkTitle}
              >
                <Group gap={2}>
                  {alertIcon}
                  {alertName}
                </Group>
              </Link>
            ) : (
              <Group gap={2} data-testid={`alert-name-${alert._id}`}>
                {alertIcon}
                {alertName}
              </Group>
            )}
          </div>
          <AlertPropertiesSummary alert={alert} />
          {alert.createdBy && (
            <Text size="xs" c="dimmed" data-testid="alert-created-by">
              Created by {alert.createdBy.name || alert.createdBy.email}
            </Text>
          )}
          {alert.tags?.length > 0 && (
            <Group gap={4}>
              {alert.tags.map(tag => (
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
          alertName={alert.displayName}
        />
      </Group>
    </div>
  );
});
