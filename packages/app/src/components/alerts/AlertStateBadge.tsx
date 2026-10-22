import * as React from 'react';
import { Badge } from '@clickhouse/click-ui';
import { AlertState } from '@hyperdx/common-utils/dist/types';

import { ALERT_STATE_LABELS } from '@/utils/alerts';

type AlertStateBadgeProps = {
  state: AlertState;
};

export function AlertStateBadge({ state }: AlertStateBadgeProps) {
  const label = ALERT_STATE_LABELS[state] ?? state;

  switch (state) {
    case AlertState.ALERT:
      return <Badge text={label} state="danger" type="solid" />;
    case AlertState.PENDING:
      return <Badge text={label} state="warning" />;
    case AlertState.ERROR:
      return <Badge text={label} state="danger" />;
    case AlertState.OK:
      return <Badge text={label} state="success" />;
    default:
      return <Badge text={label} state="neutral" />;
  }
}
