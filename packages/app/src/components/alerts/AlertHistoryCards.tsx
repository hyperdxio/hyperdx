import * as React from 'react';
import cx from 'classnames';
import { formatRelative } from 'date-fns';
import { AlertHistory, AlertState } from '@hyperdx/common-utils/dist/types';
import { Tooltip } from '@mantine/core';

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

export function AlertHistoryCardList({
  history,
  alertUrl,
}: {
  history: AlertHistory[];
  alertUrl?: string;
}) {
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
          <AlertHistoryCard key={index} history={history} alertUrl={alertUrl} />
        ))}
    </div>
  );
}
