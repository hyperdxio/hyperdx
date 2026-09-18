import * as React from 'react';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import { Badge } from '@mantine/core';

import { ALERT_STATE_LABELS } from '@/utils/alerts';

type AlertStateBadgeProps = {
  state: AlertState;
};

export function AlertStateBadge({ state }: AlertStateBadgeProps) {
  const label = ALERT_STATE_LABELS[state] ?? state;

  switch (state) {
    case AlertState.ALERT:
      return (
        <Badge variant="light" color="red">
          {label}
        </Badge>
      );
    case AlertState.PENDING:
      return (
        <Badge variant="light" color="orange">
          {label}
        </Badge>
      );
    case AlertState.ERROR:
      return (
        <Badge variant="outline" color="red">
          {label}
        </Badge>
      );
    case AlertState.OK:
      return <Badge variant="light">{label}</Badge>;
    default:
      return (
        <Badge variant="light" color="gray">
          {label}
        </Badge>
      );
  }
}
