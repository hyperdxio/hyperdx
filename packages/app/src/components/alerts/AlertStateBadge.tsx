import * as React from 'react';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import { Badge } from '@mantine/core';

type AlertStateBadgeProps = {
  state: AlertState;
};

export function AlertStateBadge({ state }: AlertStateBadgeProps) {
  switch (state) {
    case AlertState.ALERT:
      return (
        <Badge variant="light" color="red">
          Alert
        </Badge>
      );
    case AlertState.PENDING:
      return (
        <Badge variant="light" color="orange">
          Pending
        </Badge>
      );
    case AlertState.ERROR:
      return (
        <Badge variant="outline" color="red">
          Error
        </Badge>
      );
    case AlertState.OK:
      return <Badge variant="light">Ok</Badge>;
    default:
      return (
        <Badge variant="light" color="gray">
          {state}
        </Badge>
      );
  }
}
