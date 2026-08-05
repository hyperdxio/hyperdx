import { AlertState } from '@hyperdx/common-utils/dist/types';
import { Badge } from '@mantine/core';

export function AlertStateBadge({ state }: { state?: AlertState }) {
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
    case AlertState.OK:
      return <Badge variant="light">Ok</Badge>;
    case AlertState.DISABLED:
      return (
        <Badge variant="light" color="gray">
          Disabled
        </Badge>
      );
    default:
      return null;
  }
}
