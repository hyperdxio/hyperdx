import * as React from 'react';
import type { Duration } from 'date-fns';
import { add } from 'date-fns';
import { Button, Menu } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBell } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import api from '@/api';
import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import type { AlertsPageItem } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { isAlertSilenceExpired } from '@/utils/alerts';

export function AckAlert({ alert }: { alert: AlertsPageItem }) {
  const queryClient = useQueryClient();
  const silenceAlert = api.useSilenceAlert();
  const unsilenceAlert = api.useUnsilenceAlert();

  const mutateOptions = React.useMemo(
    () => ({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: api.getAlertsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: api.getAlertQueryKey(alert._id),
        });
      },
      onError: (error: any) => {
        const status = error?.response?.status;
        let message = 'Failed to silence alert, please try again later.';

        if (status === 404) {
          message = 'Alert not found.';
        } else if (status === 400) {
          message =
            'Invalid request. Please ensure the silence duration is valid.';
        }

        notifications.show({
          color: 'red',
          message,
        });
      },
    }),
    [queryClient, alert._id],
  );

  const handleUnsilenceAlert = React.useCallback(() => {
    unsilenceAlert.mutate(alert._id || '', mutateOptions);
  }, [alert._id, mutateOptions, unsilenceAlert]);

  const isNoLongerMuted = React.useMemo(() => {
    return isAlertSilenceExpired(alert.silenced);
  }, [alert.silenced]);

  const handleSilenceAlert = React.useCallback(
    (duration: Duration) => {
      // eslint-disable-next-line no-restricted-syntax
      const mutedUntil = add(new Date(), duration);
      silenceAlert.mutate(
        {
          alertId: alert._id || '',
          mutedUntil: mutedUntil.toISOString(),
        },
        mutateOptions,
      );
    },
    [alert._id, mutateOptions, silenceAlert],
  );

  if (alert.silenced?.at) {
    return (
      <ErrorBoundary message="Failed to load alert acknowledgment menu">
        <Menu>
          <Menu.Target>
            <Button
              size="compact-sm"
              variant="primary"
              color={
                isNoLongerMuted
                  ? 'var(--color-bg-warning)'
                  : 'var(--color-bg-success)'
              }
              leftSection={<IconBell size={16} />}
            >
              Ack&apos;d
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label py={6}>
              Acknowledged{' '}
              {alert.silenced?.by ? (
                <>
                  by <strong>{alert.silenced?.by}</strong>
                </>
              ) : null}{' '}
              on <br />
              <FormatTime value={alert.silenced?.at} />
              .<br />
            </Menu.Label>

            <Menu.Label py={6}>
              {isNoLongerMuted ? (
                'Alert resumed.'
              ) : (
                <>
                  Resumes <FormatTime value={alert.silenced.until} />.
                </>
              )}
            </Menu.Label>
            <Menu.Item
              lh="1"
              py={8}
              color="orange"
              onClick={handleUnsilenceAlert}
              disabled={unsilenceAlert.isPending}
            >
              {isNoLongerMuted ? 'Unacknowledge' : 'Resume alert'}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </ErrorBoundary>
    );
  }

  if (alert.state === 'ALERT') {
    return (
      <ErrorBoundary message="Failed to load alert acknowledgment menu">
        <Menu disabled={silenceAlert.isPending}>
          <Menu.Target>
            <Button size="compact-sm" variant="secondary">
              Ack
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label lh="1" py={6}>
              Acknowledge and silence for
            </Menu.Label>
            <Menu.Item
              lh="1"
              py={8}
              onClick={() =>
                handleSilenceAlert({
                  minutes: 30,
                })
              }
            >
              30 minutes
            </Menu.Item>
            <Menu.Item
              lh="1"
              py={8}
              onClick={() =>
                handleSilenceAlert({
                  hours: 1,
                })
              }
            >
              1 hour
            </Menu.Item>
            <Menu.Item
              lh="1"
              py={8}
              onClick={() =>
                handleSilenceAlert({
                  hours: 6,
                })
              }
            >
              6 hours
            </Menu.Item>
            <Menu.Item
              lh="1"
              py={8}
              onClick={() =>
                handleSilenceAlert({
                  hours: 24,
                })
              }
            >
              24 hours
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </ErrorBoundary>
    );
  }

  return null;
}
