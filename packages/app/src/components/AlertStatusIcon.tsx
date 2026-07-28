import { useTranslation } from 'react-i18next';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import { Tooltip } from '@mantine/core';
import { IconBell, IconBellFilled } from '@tabler/icons-react';

export function AlertStatusIcon({
  alerts,
}: {
  alerts?: { state?: AlertState }[];
}) {
  const { t } = useTranslation('alerts');
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  const alertingCount = alerts.filter(a => a.state === AlertState.ALERT).length;
  const pendingCount = alerts.filter(
    a => a.state === AlertState.PENDING,
  ).length;
  return (
    <Tooltip
      label={
        alertingCount > 0
          ? t('status.triggered', { count: alertingCount })
          : pendingCount > 0
            ? t('status.pending', { count: pendingCount })
            : t('status.configured')
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
