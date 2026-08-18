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

export const ALERT_ERROR_TYPE_LABELS: Record<AlertErrorType, string> = {
  [AlertErrorType.INVALID_ALERT]: 'Invalid Configuration',
  [AlertErrorType.QUERY_ERROR]: 'Query Error',
  [AlertErrorType.QUERY_TIMEOUT]: 'Query Timeout',
  [AlertErrorType.WEBHOOK_ERROR]: 'Webhook Error',
  [AlertErrorType.UNKNOWN]: 'Unknown Error',
};

function stateToBgColorClass(state: AlertState) {
  switch (state) {
    case AlertState.OK:
      return styles.ok;
    case AlertState.PENDING:
      return styles.pending;
    case AlertState.ERROR:
      return styles.error;
    default:
      return styles.alarm;
  }
}

export function AlertErrorsContent({ errors }: { errors: AlertError[] }) {
  return (
    <Stack gap="md">
      {errors.map((error, idx) => (
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
  );
}

/** Dedupe errors by type+message, keeping the most recent occurrence. */
function dedupeAlertErrors(errors: AlertError[]): AlertError[] {
  const map = new Map<string, AlertError>();
  for (const error of errors) {
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
  return Array.from(map.values());
}

function errorTypeSummary(errors: AlertError[]): string {
  const types = Array.from(new Set(errors.map(error => error.type)));
  return types.length === 1
    ? ALERT_ERROR_TYPE_LABELS[types[0]]
    : 'Multiple Errors';
}

function AlertHistoryCard({
  history,
  alertUrl,
  onShowErrors,
}: {
  history: AlertHistory;
  alertUrl?: string;
  onShowErrors: (history: AlertHistory) => void;
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

  const isError = history.state === AlertState.ERROR;
  const time = formatRelative(start, today);

  const content = (
    <div
      className={cx(
        styles.historyCard,
        stateToBgColorClass(history.state),
        (href || isError) && styles.clickable,
      )}
    />
  );

  const label = React.useMemo(() => {
    if (isError) {
      const summary = errorTypeSummary(history.errors ?? []);
      return `Evaluation failed (${summary}) ${time}. Click for details.`;
    }
    const count = history.counts ?? 0;
    const pending = history.state === AlertState.PENDING ? 'pending' : '';
    const alert = `alert${count === 0 || count > 1 ? 's' : ''}`;
    return `${count} ${pending} ${alert} ${time}`;
  }, [isError, history, time]);

  return (
    <Tooltip label={label} color="dark" withArrow>
      {isError ? (
        <UnstyledButton
          className={styles.historyCardLink}
          onClick={() => onShowErrors(history)}
          aria-label="View evaluation errors"
        >
          {content}
        </UnstyledButton>
      ) : href ? (
        <a href={href} className={styles.historyCardLink}>
          {content}
        </a>
      ) : (
        content
      )}
    </Tooltip>
  );
}

function AlertErrorsIndicator({ alert }: { alert: AlertsPageItem }) {
  const [opened, { open, close }] = useDisclosure(false);

  const uniqueErrors = React.useMemo(
    () => dedupeAlertErrors(alert.executionErrors ?? []),
    [alert.executionErrors],
  );

  if (uniqueErrors.length === 0) return null;

  const errorType = errorTypeSummary(uniqueErrors);

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
        <AlertErrorsContent errors={uniqueErrors} />
      </Modal>
    </>
  );
}

export function AlertHistoryCardList({
  alert,
  alertUrl,
  history: historyProp,
  maxItems = HISTORY_ITEMS,
  showErrorIndicator = true,
}: {
  alert: AlertsPageItem;
  alertUrl?: string;
  /** Evaluation windows to render; defaults to the alert's inline history. */
  history?: AlertHistory[];
  maxItems?: number;
  showErrorIndicator?: boolean;
}) {
  const history = historyProp ?? alert.history;
  const [errorHistory, setErrorHistory] = React.useState<AlertHistory | null>(
    null,
  );

  const items = React.useMemo(() => {
    if (history.length < maxItems) {
      return history;
    }
    return history.slice(0, maxItems);
  }, [history, maxItems]);

  const paddingItems = React.useMemo(() => {
    if (history.length > maxItems) {
      return [];
    }
    return new Array(maxItems - history.length).fill(null);
  }, [history, maxItems]);

  const modalErrors = React.useMemo(
    () => dedupeAlertErrors(errorHistory?.errors ?? []),
    [errorHistory],
  );

  return (
    <Group gap="xs" wrap="nowrap">
      {showErrorIndicator && <AlertErrorsIndicator alert={alert} />}
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
                onShowErrors={setErrorHistory}
              />
            ))}
        </div>
      )}
      <Modal
        opened={errorHistory != null}
        onClose={() => setErrorHistory(null)}
        size="lg"
        title={
          <>
            Evaluation Errors
            {errorHistory != null && (
              <Text span size="sm" c="dimmed" ml="xs">
                <FormatTime value={errorHistory.createdAt} />
              </Text>
            )}
          </>
        }
        data-testid={`alert-evaluation-error-modal-${alert._id}`}
      >
        <AlertErrorsContent errors={modalErrors} />
      </Modal>
    </Group>
  );
}
