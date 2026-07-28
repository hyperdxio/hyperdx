import * as React from 'react';
import cx from 'classnames';
import { formatRelative } from 'date-fns';
import { useTranslation } from 'react-i18next';
import {
  AlertError,
  AlertErrorType,
  AlertHistory,
  AlertState,
} from '@hyperdx/common-utils/dist/types';
import {
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

import styles from '@styles/AlertsPage.module.scss';

const HISTORY_ITEMS = 18;

function stateToBgColorClass(state: AlertState) {
  switch (state) {
    case AlertState.OK:
      return styles.ok;
    case AlertState.PENDING:
      return styles.pending;
    default:
      return styles.alarm;
  }
}

function AlertHistoryCard({
  history,
  alertUrl,
}: {
  history: AlertHistory;
  alertUrl?: string;
}) {
  const { t } = useTranslation('alerts');
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
        stateToBgColorClass(history.state),
        href && styles.clickable,
      )}
    />
  );

  const count = history.counts ?? 0;
  const pending =
    history.state === AlertState.PENDING ? t('history.pending') : '';
  const time = formatRelative(start, today);
  const label = t('history.tooltip', { count, pending, time });

  return (
    <Tooltip label={label} color="dark" withArrow>
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

const ALERT_ERROR_TYPE_KEYS = {
  [AlertErrorType.INVALID_ALERT]: 'history.errorTypes.invalid',
  [AlertErrorType.QUERY_ERROR]: 'history.errorTypes.query',
  [AlertErrorType.WEBHOOK_ERROR]: 'history.errorTypes.webhook',
  [AlertErrorType.UNKNOWN]: 'history.errorTypes.unknown',
} as const;

type AlertErrorTypeKey =
  (typeof ALERT_ERROR_TYPE_KEYS)[keyof typeof ALERT_ERROR_TYPE_KEYS];

const getAlertErrorTypeKey = (type: AlertErrorType): AlertErrorTypeKey => {
  return ALERT_ERROR_TYPE_KEYS[type];
};

function AlertErrorsIndicator({ alert }: { alert: AlertsPageItem }) {
  const { t } = useTranslation('alerts');
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
      ? t(getAlertErrorTypeKey(uniqueTypes[0]))
      : t('history.errorTypes.multiple');

  return (
    <>
      <Tooltip
        label={t('history.details', { errorType })}
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
          aria-label={t('history.viewErrors')}
        >
          <IconExclamationCircle size={18} />
        </UnstyledButton>
      </Tooltip>

      <Modal
        opened={opened}
        onClose={close}
        size="lg"
        title={t('history.errorsTitle')}
        data-testid={`alert-error-modal-${alert._id}`}
      >
        <Stack gap="md">
          {uniqueErrors.map((error, idx) => (
            <Stack key={idx} gap={4}>
              <Text size="sm">
                {t('history.errorAt', {
                  errorType: t(getAlertErrorTypeKey(error.type)),
                })}{' '}
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
  const { t } = useTranslation('alerts');
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
            <Tooltip label={t('history.noData')} withArrow key={index}>
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
