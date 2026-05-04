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
  return (
    <Tooltip
      label={
        alertingCount > 0
          ? `${alertingCount} alert${alertingCount > 1 ? 's' : ''} triggered`
          : 'Alerts configured'
      }
    >
      {alertingCount > 0 ? (
        <IconBellFilled
          size={14}
          color="var(--mantine-color-red-filled)"
          data-testid="alert-status-icon-triggered"
        />
      ) : (
        <IconBell size={14} data-testid="alert-status-icon-configured" />
      )}
    </Tooltip>
  );
}
