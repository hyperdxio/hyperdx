import { Fragment } from 'react';
import { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import { Menu } from '@mantine/core';
import { IconCornerDownRight, IconFolderSymlink } from '@tabler/icons-react';

export type MoveTarget = {
  containerId: string;
  tabId?: string;
  label: string;
  // Heading for the tabs of a multi-tab group
  group?: string;
};

export function buildMoveTargets(
  containers: DashboardContainer[],
): MoveTarget[] {
  return containers.flatMap(c => {
    const tabs = c.tabs ?? [];
    if (tabs.length === 0) return [{ containerId: c.id, label: c.title }];
    if (tabs.length === 1)
      return [{ containerId: c.id, tabId: tabs[0].id, label: tabs[0].title }];
    // A multi-tab group is named by its first tab, matching its header
    return tabs.map(tab => ({
      containerId: c.id,
      tabId: tab.id,
      label: tab.title,
      group: tabs[0].title,
    }));
  });
}

// A submenu keeps the tile menu short however many groups the dashboard has.
export function MoveToGroupSubmenu({
  moveTargets,
  containerId,
  tabId,
  onMoveToGroup,
}: {
  moveTargets: MoveTarget[];
  containerId?: string;
  tabId?: string;
  onMoveToGroup: (containerId: string | undefined, tabId?: string) => void;
}) {
  const targets = moveTargets.filter(
    t => !(t.containerId === containerId && t.tabId === tabId),
  );

  return (
    <Menu.Sub>
      <Menu.Sub.Target>
        <Menu.Sub.Item leftSection={<IconFolderSymlink size={14} />}>
          Move to group
        </Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown mah={320} style={{ overflowY: 'auto' }}>
        {containerId && (
          <Menu.Item
            leftSection={<IconCornerDownRight size={14} />}
            onClick={() => onMoveToGroup(undefined)}
          >
            (Ungrouped)
          </Menu.Item>
        )}
        {containerId && targets.length > 0 && <Menu.Divider role="separator" />}
        {targets.map((t, i) => {
          const prev = targets[i - 1];
          // Sections key on container, since default group names repeat
          const newContainer = prev?.containerId !== t.containerId;
          return (
            <Fragment key={`${t.containerId}-${t.tabId ?? ''}`}>
              {prev && newContainer && (prev.group || t.group) && (
                <Menu.Divider role="separator" />
              )}
              {t.group && newContainer && <Menu.Label>{t.group}</Menu.Label>}
              <Menu.Item
                leftSection={<IconCornerDownRight size={14} />}
                onClick={() => onMoveToGroup(t.containerId, t.tabId)}
              >
                {t.label}
              </Menu.Item>
            </Fragment>
          );
        })}
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
}
