import { AlertState } from '@hyperdx/common-utils/dist/types';
import { Tooltip } from '@mantine/core';
import { IconBell, IconBellFilled } from '@tabler/icons-react';

export function AlertStatusIcon({
  alerts,
}: {
  alerts?: { state?: AlertState }[];
}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  const alertingCount = alerts.filter(a => a.state === AlertState.ALERT).length;
  const pendingCount = alerts.filter(
    a => a.state === AlertState.PENDING,
  ).length;
  return (
    <Tooltip
      label={
        alertingCount > 0
          ? `${alertingCount} alert${alertingCount > 1 ? 's' : ''} triggered`
          : pendingCount > 0
            ? `${pendingCount} alert${pendingCount > 1 ? 's' : ''} pending`
            : 'Alerts configured'
      }
    >
      {alertingCount > 0 ? (
        <IconBellFilled
          size={14}
          color="var(--mantine-color-red-filled)"
          data-testid="alert-status-icon-triggered"
        />
      ) : pendingCount > 0 ? (
        <IconBellFilled
          size={14}
          color="var(--mantine-color-orange-filled)"
          data-testid="alert-status-icon-pending"
        />
      ) : (
        <IconBell size={14} data-testid="alert-status-icon-configured" />
      )}
    </Tooltip>
  );
}
