import * as React from 'react';
import cx from 'classnames';
import { formatRelative } from 'date-fns';
import {
  AlertError,
  AlertErrorType,
  AlertHistory,
  AlertState,
} from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Code,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconExclamationCircle } from '@tabler/icons-react';

import type { AlertsPageItem } from '@/types';
import { FormatTime } from '@/useFormatTime';

import styles from '../../../styles/AlertsPage.module.scss';

const HISTORY_ITEMS = 18;

function AlertHistoryCard({
  history,
  alertUrl,
}: {
  history: AlertHistory;
  alertUrl?: string;
}) {
  const start = new Date(history.createdAt.toString());

  // eslint-disable-next-line no-restricted-syntax
  const today = React.useMemo(() => new Date(), []);

  const href = React.useMemo(() => {
    if (!alertUrl || !history.lastValues?.[0]?.startTime) return null;

    // Create time window from alert creation to last recorded value
    const to = new Date(history.createdAt).getTime();
    const from = new Date(history.lastValues[0].startTime).getTime();

    // Construct URL with time range parameters
    const url = new URL(alertUrl, window.location.origin);
    url.searchParams.set('from', from.toString());
    url.searchParams.set('to', to.toString());
    url.searchParams.set('isLive', 'false');

    return url.pathname + url.search;
  }, [history, alertUrl]);

  const content = (
    <div
      className={cx(
        styles.historyCard,
        history.state === AlertState.OK ? styles.ok : styles.alarm,
        href && styles.clickable,
      )}
    />
  );

  return (
    <Tooltip
      label={`${history.counts ?? 0} alerts ${formatRelative(start, today)}`}
      color="dark"
      withArrow
    >
      {href ? (
        <a href={href} className={styles.historyCardLink}>
          {content}
        </a>
      ) : (
        content
      )}
    </Tooltip>
  );
}

const ALERT_ERROR_TYPE_LABELS: Record<AlertErrorType, string> = {
  [AlertErrorType.INVALID_ALERT]: 'Invalid Configuration',
  [AlertErrorType.QUERY_ERROR]: 'Query Error',
  [AlertErrorType.WEBHOOK_ERROR]: 'Webhook Error',
  [AlertErrorType.UNKNOWN]: 'Unknown Error',
};

function AlertErrorsIndicator({ alert }: { alert: AlertsPageItem }) {
  const [opened, { open, close }] = useDisclosure(false);

  const { uniqueErrors, uniqueTypes } = React.useMemo(() => {
    const map = new Map<string, AlertError>();
    for (const error of alert.executionErrors ?? []) {
      const key = `${error.type}||${error.message}`;
      const existing = map.get(key);
      if (
        !existing ||
        new Date(error.timestamp).getTime() >
          new Date(existing.timestamp).getTime()
      ) {
        map.set(key, error);
      }
    }
    const errors = Array.from(map.values());
    const types = Array.from(new Set(errors.map(error => error.type)));
    return { uniqueErrors: errors, uniqueTypes: types };
  }, [alert.executionErrors]);

  if (uniqueErrors.length === 0) return null;

  const errorType =
    uniqueTypes.length === 1
      ? ALERT_ERROR_TYPE_LABELS[uniqueTypes[0]]
      : 'Multiple Errors';

  return (
    <>
      <Tooltip
        label={`${errorType} (Click for details)`}
        multiline
        maw={400}
        withArrow
        color="dark"
      >
        <UnstyledButton
          data-testid={`alert-error-icon-${alert._id}`}
          onClick={open}
          style={{
            display: 'inline-flex',
            color: 'var(--mantine-color-red-6)',
            cursor: 'pointer',
          }}
          aria-label="View alert execution errors"
        >
          <IconExclamationCircle size={18} />
        </UnstyledButton>
      </Tooltip>

      <Modal
        opened={opened}
        onClose={close}
        size="lg"
        title="Alert Execution Errors"
        data-testid={`alert-error-modal-${alert._id}`}
      >
        <Stack gap="md">
          {uniqueErrors.map((error, idx) => (
            <Stack key={idx} gap={4}>
              <Text size="sm">
                {ALERT_ERROR_TYPE_LABELS[error.type]} at{' '}
                <FormatTime value={error.timestamp} />
              </Text>
              <Code
                flex={1}
                block
                style={{
                  whiteSpace: 'pre-wrap',
                }}
              >
                {error.message}
              </Code>
            </Stack>
          ))}
        </Stack>
      </Modal>
    </>
  );
}

export function AlertHistoryCardList({
  alert,
  alertUrl,
}: {
  alert: AlertsPageItem;
  alertUrl?: string;
}) {
  const { history } = alert;
  const items = React.useMemo(() => {
    if (history.length < HISTORY_ITEMS) {
      return history;
    }
    return history.slice(0, HISTORY_ITEMS);
  }, [history]);

  const paddingItems = React.useMemo(() => {
    if (history.length > HISTORY_ITEMS) {
      return [];
    }
    return new Array(HISTORY_ITEMS - history.length).fill(null);
  }, [history]);

  return (
    <Group gap="xs" wrap="nowrap">
      <AlertErrorsIndicator alert={alert} />
      {items.length > 0 && (
        <div className={styles.historyCardWrapper}>
          {paddingItems.map((_, index) => (
            <Tooltip label="No data" withArrow key={index}>
              <div className={styles.historyCard} />
            </Tooltip>
          ))}
          {items
            .slice()
            .reverse()
            .map((history, index) => (
              <AlertHistoryCard
                key={index}
                history={history}
                alertUrl={alertUrl}
              />
            ))}
        </div>
      )}
    </Group>
  );
}
