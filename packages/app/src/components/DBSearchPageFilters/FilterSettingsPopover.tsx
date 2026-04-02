import {
  ActionIcon,
  Button,
  Checkbox,
  Divider,
  Flex,
  Popover,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';

function SettingsPopover({
  target,
  children,
}: {
  target: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Popover width={220} trapFocus position="right" withArrow shadow="md">
      <Popover.Target>{target}</Popover.Target>
      <Popover.Dropdown>{children}</Popover.Dropdown>
    </Popover>
  );
}

/**
 * Global filter settings gear icon — shown next to the "Filters" header.
 * Controls visibility of the shared filters section.
 */
export function FilterSettingsPanel({
  isSharedFiltersVisible,
  onSharedFiltersVisibilityChange,
  hasSharedFilters,
  onResetSharedFilters,
}: {
  isSharedFiltersVisible: boolean;
  onSharedFiltersVisibilityChange: (visible: boolean) => void;
  hasSharedFilters: boolean;
  onResetSharedFilters: VoidFunction;
}) {
  return (
    <SettingsPopover
      target={
        <Tooltip
          label="Filter Settings"
          position="top"
          withArrow
          fz="xxs"
          color="gray"
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            aria-label="Filter settings"
          >
            <IconSettings size={14} />
          </ActionIcon>
        </Tooltip>
      }
    >
      <Flex direction="column" gap="xs">
        <Text size="sm" fw={500}>
          Filter Settings
        </Text>
        <Divider />
        <Checkbox
          label="Show Shared Filters"
          labelPosition="left"
          size="xs"
          styles={{
            labelWrapper: {
              width: '100%',
            },
          }}
          checked={isSharedFiltersVisible}
          onChange={e =>
            onSharedFiltersVisibilityChange(e.currentTarget.checked)
          }
        />
        {hasSharedFilters && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="red"
            onClick={onResetSharedFilters}
          >
            Reset Shared Filters
          </Button>
        )}
      </Flex>
    </SettingsPopover>
  );
}
