import * as React from 'react';
import type { Duration } from 'date-fns';
import { add } from 'date-fns';
import { notifications } from '@mantine/notifications';
import { IconBell } from '@tabler/icons-react';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';

import api from '@/api';
import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import type { AlertsPageItem } from '@/types';
import { isAlertSilenceExpired } from '@/utils/alerts';

import { AlertAckMenu } from './AlertAckMenu';

type AlertSilence = AlertsPageItem['silenced'];
type AlertGroup = NonNullable<AlertsPageItem['groups']>[number];

function isActiveSilence(silence?: AlertSilence) {
  return silence?.at ? !isAlertSilenceExpired(silence) : false;
}

export function isGroupMutedByParentAck({
  group,
  parentSilenced,
}: {
  group: AlertGroup;
  parentSilenced?: AlertSilence;
}) {
  const isParentAckActive = isActiveSilence(parentSilenced);
  const isGroupAckActive = isActiveSilence(group.silenced);
  const hasGroupResumeOverride =
    isParentAckActive &&
    group.unsilenced?.parentSilencedAt === parentSilenced?.at;

  return (
    group.state === 'ALERT' &&
    isParentAckActive &&
    !isGroupAckActive &&
    !hasGroupResumeOverride
  );
}

function getErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !('response' in error)) return undefined;

  const { response } = error;
  if (!response || typeof response !== 'object' || !('status' in response)) {
    return undefined;
  }

  const { status } = response;
  return typeof status === 'number' ? status : undefined;
}

function getAckMutationOptions({
  alertId,
  queryClient,
}: {
  alertId: string;
  queryClient: QueryClient;
}) {
  return {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: api.getAlertsQueryKey() });
      queryClient.invalidateQueries({
        queryKey: api.getAlertQueryKey(alertId),
      });
    },
    onError: (error: unknown) => {
      const status = getErrorStatus(error);
      let message =
        'Failed to update alert acknowledgment, please try again later.';

      if (status === 404) {
        message = 'Alert not found.';
      } else if (status === 400) {
        message = 'Invalid acknowledgment request. Refresh and try again.';
      }

      notifications.show({
        color: 'red',
        message,
      });
    },
  };
}

export function AckAlert({ alert }: { alert: AlertsPageItem }) {
  const queryClient = useQueryClient();
  const silenceAlert = api.useSilenceAlert();
  const unsilenceAlert = api.useUnsilenceAlert();

  const mutateOptions = React.useMemo(
    () => getAckMutationOptions({ alertId: alert._id, queryClient }),
    [queryClient, alert._id],
  );

  const handleUnsilenceAlert = React.useCallback(() => {
    unsilenceAlert.mutate(alert._id || '', mutateOptions);
  }, [alert._id, mutateOptions, unsilenceAlert]);

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

  return (
    <ErrorBoundary message="Failed to load alert acknowledgment menu">
      <AlertAckMenu
        isPending={silenceAlert.isPending || unsilenceAlert.isPending}
        onSilence={handleSilenceAlert}
        onUnsilence={handleUnsilenceAlert}
        silenced={alert.silenced}
        state={alert.state}
      />
    </ErrorBoundary>
  );
}

export function AckAlertGroup({
  alertId,
  group,
  parentSilenced,
}: {
  alertId: string;
  group: AlertGroup;
  parentSilenced?: AlertSilence;
}) {
  const queryClient = useQueryClient();
  const silenceAlertGroup = api.useSilenceAlertGroup();
  const unsilenceAlertGroup = api.useUnsilenceAlertGroup();
  const resumeAlertGroup = api.useResumeAlertGroup();
  const clearAlertGroupResume = api.useClearAlertGroupResume();

  const mutateOptions = React.useMemo(
    () => getAckMutationOptions({ alertId, queryClient }),
    [queryClient, alertId],
  );

  const isParentAckActive = React.useMemo(
    () => isActiveSilence(parentSilenced),
    [parentSilenced],
  );

  const isGroupAckActive = isActiveSilence(group.silenced);

  const hasGroupResumeOverride =
    isParentAckActive &&
    group.unsilenced?.parentSilencedAt === parentSilenced?.at;

  const isMutedByParentAck = isGroupMutedByParentAck({
    group,
    parentSilenced,
  });
  const effectiveSilenced = isGroupAckActive
    ? group.silenced
    : isMutedByParentAck
      ? parentSilenced
      : group.silenced;

  const secondarySilenced =
    group.state === 'ALERT' &&
    isGroupAckActive &&
    isParentAckActive &&
    !hasGroupResumeOverride
      ? parentSilenced
      : undefined;

  const handleUnsilenceAlertGroup = React.useCallback(() => {
    unsilenceAlertGroup.mutate(
      {
        alertId,
        group: group.group,
      },
      mutateOptions,
    );
  }, [alertId, group.group, mutateOptions, unsilenceAlertGroup]);

  const handleResumeAlertGroup = React.useCallback(() => {
    resumeAlertGroup.mutate(
      {
        alertId,
        group: group.group,
      },
      mutateOptions,
    );
  }, [alertId, group.group, mutateOptions, resumeAlertGroup]);

  const handleClearAlertGroupResume = React.useCallback(() => {
    clearAlertGroupResume.mutate(
      {
        alertId,
        group: group.group,
      },
      mutateOptions,
    );
  }, [alertId, clearAlertGroupResume, group.group, mutateOptions]);

  const handleSilenceAlertGroup = React.useCallback(
    (duration: Duration) => {
      // eslint-disable-next-line no-restricted-syntax
      const mutedUntil = add(new Date(), duration);
      silenceAlertGroup.mutate(
        {
          alertId,
          group: group.group,
          mutedUntil: mutedUntil.toISOString(),
        },
        mutateOptions,
      );
    },
    [alertId, group.group, mutateOptions, silenceAlertGroup],
  );

  return (
    <ErrorBoundary message="Failed to load alert group acknowledgment menu">
      <AlertAckMenu
        acknowledgedButtonIcon={<IconBell size={16} />}
        acknowledgedButtonLabel={isMutedByParentAck ? 'Muted' : "Ack'd"}
        acknowledgedButtonVariant={isMutedByParentAck ? 'subtle' : 'primary'}
        canUnsilence={isMutedByParentAck || group.silenced != null}
        description={isMutedByParentAck ? 'Muted by parent ack.' : undefined}
        isPending={
          silenceAlertGroup.isPending ||
          unsilenceAlertGroup.isPending ||
          resumeAlertGroup.isPending ||
          clearAlertGroupResume.isPending
        }
        onSilence={handleSilenceAlertGroup}
        onResetToInherited={
          hasGroupResumeOverride
            ? handleClearAlertGroupResume
            : isGroupAckActive && isParentAckActive
              ? handleUnsilenceAlertGroup
              : undefined
        }
        onUnsilence={
          isParentAckActive ? handleResumeAlertGroup : handleUnsilenceAlertGroup
        }
        secondarySilenced={secondarySilenced}
        secondarySilencedLabel="Parent alert acknowledgment also exists"
        silenced={effectiveSilenced}
        silencedLabel={
          isMutedByParentAck ? 'Parent ack' : 'This group is acknowledged'
        }
        silenceOptionsLabel={
          effectiveSilenced?.at ? 'Acknowledge this group for' : undefined
        }
        state={group.state}
        unacknowledgedButtonIcon={<IconBell size={16} />}
        unsilenceLabel={isParentAckActive ? 'Resume group' : undefined}
      />
    </ErrorBoundary>
  );
}
