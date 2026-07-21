import cx from 'classnames';
import { Group, Stack, Text } from '@mantine/core';

import type { AlertsPageItem } from '@/types';
import { truncateMiddle } from '@/utils';

import { AckAlertGroup, isGroupMutedByParentAck } from './AckAlert';
import { AlertHistoryCardStack } from './AlertHistoryCards';
import { AlertStateBadge } from './AlertStateBadge';

import styles from '@styles/AlertsPage.module.scss';

function getAlertGroupDisplayName(group: string) {
  return group.replace(
    /^arrayElement\((\w+), '([^']+)'\):/,
    (_, mapName: string, key: string) => `${mapName}['${key}']:`,
  );
}

export function getVisibleAlertGroups(
  alert: AlertsPageItem,
  state: AlertsPageItem['state'] = alert.state,
) {
  return alert.groups?.filter(group => group.state === state) ?? [];
}

export function AlertGroupRows({
  alert,
  state,
}: {
  alert: AlertsPageItem;
  state?: AlertsPageItem['state'];
}) {
  const groups = getVisibleAlertGroups(alert, state);
  const testIdState = state ?? alert.state;
  if (!groups.length) return null;

  return (
    <Stack gap={0} className={styles.alertGroupRows}>
      {groups.map((group, index) => {
        const displayGroup = getAlertGroupDisplayName(group.group);
        const truncatedDisplayGroup = truncateMiddle(displayGroup, 35);
        const rowTestId = `alert-group-row-${alert._id}-${testIdState}-${index}`;
        const isMutedByParentAck = isGroupMutedByParentAck({
          group,
          parentSilenced: alert.silenced,
        });

        return (
          <div
            key={group.group}
            className={cx(styles.alertGroupRow, {
              [styles.alertGroupRowInheritedMuted]: isMutedByParentAck,
            })}
            data-testid={rowTestId}
          >
            <Group gap="sm" wrap="nowrap" className={styles.alertGroupMeta}>
              <AlertStateBadge state={group.state} />
              <Text
                size="sm"
                className={styles.alertGroupLabel}
                title={group.group}
              >
                {truncatedDisplayGroup}
              </Text>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <AlertHistoryCardStack history={group.history} />
              <AckAlertGroup
                alertId={alert._id}
                group={group}
                parentSilenced={alert.silenced}
              />
            </Group>
          </div>
        );
      })}
    </Stack>
  );
}
