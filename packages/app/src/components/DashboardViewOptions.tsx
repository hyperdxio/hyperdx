import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';

type DashboardViewOptionsProps = {
  /** Collapses every container on the dashboard to its header. */
  onCollapseAll: () => void;
  /** Expands every container on the dashboard. */
  onExpandAll: () => void;
  /** Current per-user preference for whether the sticky TOC rail is visible. */
  tocVisible: boolean;
  /** Toggles `tocVisible` in the user preferences atom. */
  onToggleToc: () => void;
};

/**
 * Toolbar control that opens a small "view options" menu for the current
 * dashboard. Currently exposes batch collapse/expand of all sections and a
 * toggle for the sticky table-of-contents rail. Lives next to the existing
 * filter / refresh / run actions in the dashboard toolbar.
 */
export function DashboardViewOptions({
  onCollapseAll,
  onExpandAll,
  tocVisible,
  onToggleToc,
}: DashboardViewOptionsProps) {
  return (
    <Menu position="bottom-end" width={220} withinPortal>
      <Menu.Target>
        <Tooltip withArrow label="View options" fz="xs" color="gray">
          <ActionIcon
            variant="secondary"
            title="View options"
            size="input-sm"
            data-testid="dashboard-view-options"
            aria-label="View options"
          >
            <IconAdjustmentsHorizontal size={18} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Sections</Menu.Label>
        <Menu.Item
          leftSection={<IconChevronUp size={14} />}
          onClick={onCollapseAll}
          data-testid="dashboard-collapse-all"
        >
          Collapse all sections
        </Menu.Item>
        <Menu.Item
          leftSection={<IconChevronDown size={14} />}
          onClick={onExpandAll}
          data-testid="dashboard-expand-all"
        >
          Expand all sections
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item onClick={onToggleToc} data-testid="dashboard-toggle-toc">
          {tocVisible ? 'Hide table of contents' : 'Show table of contents'}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
