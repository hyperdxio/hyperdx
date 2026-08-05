import * as React from 'react';
import type { Duration } from 'date-fns';
import { Button, Menu } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';

import type { AlertsPageItem } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { isAlertSilenceExpired } from '@/utils/alerts';

type AlertSilence = AlertsPageItem['silenced'];

const ACK_DURATIONS: Array<{ label: string; duration: Duration }> = [
  { label: '30 minutes', duration: { minutes: 30 } },
  { label: '1 hour', duration: { hours: 1 } },
  { label: '6 hours', duration: { hours: 6 } },
  { label: '24 hours', duration: { hours: 24 } },
];

export function AlertAckMenu({
  acknowledgedButtonIcon,
  acknowledgedButtonLabel = "Ack'd",
  acknowledgedButtonVariant = 'primary',
  canUnsilence = true,
  description,
  isPending,
  onSilence,
  onResetToInherited,
  onUnsilence,
  resetToInheritedLabel = 'Use parent ack',
  secondarySilenced,
  secondarySilencedLabel,
  silenced,
  silencedLabel = 'Acknowledged',
  silenceOptionsLabel,
  state,
  unacknowledgedButtonIcon,
  unacknowledgedButtonLabel = 'Ack',
  unsilenceLabel,
}: {
  acknowledgedButtonIcon?: React.ReactNode;
  acknowledgedButtonLabel?: string;
  acknowledgedButtonVariant?: 'primary' | 'secondary' | 'subtle';
  canUnsilence?: boolean;
  description?: React.ReactNode;
  isPending: boolean;
  onSilence: (duration: Duration) => void;
  onResetToInherited?: () => void;
  onUnsilence: () => void;
  resetToInheritedLabel?: string;
  secondarySilenced?: AlertSilence;
  secondarySilencedLabel?: string;
  silenced?: AlertSilence;
  silencedLabel?: string;
  silenceOptionsLabel?: string;
  state?: AlertsPageItem['state'];
  unacknowledgedButtonIcon?: React.ReactNode;
  unacknowledgedButtonLabel?: string;
  unsilenceLabel?: string;
}) {
  const isNoLongerMuted = React.useMemo(
    () => isAlertSilenceExpired(silenced),
    [silenced],
  );

  if (silenced?.at && !isNoLongerMuted) {
    return (
      <Menu>
        <Menu.Target>
          <Button
            size="compact-sm"
            variant={acknowledgedButtonVariant}
            color={
              acknowledgedButtonVariant === 'primary'
                ? isNoLongerMuted
                  ? 'var(--color-bg-warning)'
                  : 'var(--color-bg-success)'
                : undefined
            }
            leftSection={acknowledgedButtonIcon ?? <IconBell size={16} />}
          >
            {acknowledgedButtonLabel}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {description ? <Menu.Label py={6}>{description}</Menu.Label> : null}
          <Menu.Label py={6}>
            {silencedLabel}{' '}
            {silenced.by ? (
              <>
                by <strong>{silenced.by}</strong>
              </>
            ) : null}{' '}
            on <br />
            <FormatTime value={silenced.at} />
            .<br />
          </Menu.Label>
          <Menu.Label py={6}>
            {isNoLongerMuted ? (
              'Alert resumed.'
            ) : (
              <>
                Resumes <FormatTime value={silenced.until} />.
              </>
            )}
          </Menu.Label>
          {secondarySilenced?.at ? (
            <>
              <Menu.Divider />
              <Menu.Label py={6}>
                {secondarySilencedLabel ?? 'Group acknowledgment'}{' '}
                {secondarySilenced.by ? (
                  <>
                    by <strong>{secondarySilenced.by}</strong>
                  </>
                ) : null}
                <br />
                Resumes <FormatTime value={secondarySilenced.until} />.
              </Menu.Label>
            </>
          ) : null}
          {canUnsilence ? (
            <Menu.Item
              lh="1"
              py={8}
              color="orange"
              onClick={onUnsilence}
              disabled={isPending}
            >
              {unsilenceLabel ??
                (isNoLongerMuted ? 'Unacknowledge' : 'Resume alert')}
            </Menu.Item>
          ) : null}
          {onResetToInherited ? (
            <Menu.Item
              lh="1"
              py={8}
              onClick={onResetToInherited}
              disabled={isPending}
            >
              {resetToInheritedLabel}
            </Menu.Item>
          ) : null}
          {silenceOptionsLabel ? (
            <>
              <Menu.Divider />
              <Menu.Label lh="1" py={6}>
                {silenceOptionsLabel}
              </Menu.Label>
              {ACK_DURATIONS.map(({ label, duration }) => (
                <Menu.Item
                  key={label}
                  lh="1"
                  py={8}
                  onClick={() => onSilence(duration)}
                >
                  {label}
                </Menu.Item>
              ))}
            </>
          ) : null}
        </Menu.Dropdown>
      </Menu>
    );
  }

  if (state !== 'ALERT') return null;

  return (
    <Menu disabled={isPending}>
      <Menu.Target>
        <Button
          size="compact-sm"
          variant="secondary"
          leftSection={unacknowledgedButtonIcon}
        >
          {unacknowledgedButtonLabel}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label lh="1" py={6}>
          Acknowledge and silence for
        </Menu.Label>
        {ACK_DURATIONS.map(({ label, duration }) => (
          <Menu.Item
            key={label}
            lh="1"
            py={8}
            onClick={() => onSilence(duration)}
          >
            {label}
          </Menu.Item>
        ))}
        {onResetToInherited ? (
          <>
            <Menu.Divider />
            <Menu.Item
              lh="1"
              py={8}
              onClick={onResetToInherited}
              disabled={isPending}
            >
              {resetToInheritedLabel}
            </Menu.Item>
          </>
        ) : null}
      </Menu.Dropdown>
    </Menu>
  );
}
