import { Label } from 'recharts';
import {
  ActionIcon,
  Button,
  Checkbox,
  Divider,
  Flex,
  Popover,
  Text,
} from '@mantine/core';
import { IconDots, IconDotsVertical, IconSettings } from '@tabler/icons-react';

function FilterSettingsPopover({
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

export function FilterSettingsGeneralSettingsPanel() {
  return (
    <FilterSettingsPopover
      target={
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xs"
          title="Additional Settings"
        >
          <IconSettings size={16} />
        </ActionIcon>
      }
    >
      <Flex direction="column" gap="xs">
        <Text size="sm">Filter Settings</Text>
        <Divider />

        <Checkbox
          label="Show Shared Filters"
          labelPosition="left"
          size="xs"
          styles={{
            label: {},
            labelWrapper: {
              width: '100%',
            },
          }}
        />
        <Button
          size="xs"
          variant="outline"
          color="gray"
          title="Additional Settings"
        >
          Reset to Default
        </Button>
      </Flex>
    </FilterSettingsPopover>
  );
}

export function FilterSettingsFacetPanel({
  isDistributionEnabled,
  setDistributionEnabled,
}: {
  isDistributionEnabled: boolean;
  setDistributionEnabled: (enabled: boolean) => void;
}) {
  return (
    <FilterSettingsPopover
      target={
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xs"
          title="Additional Settings"
        >
          <IconDotsVertical size={16} />
        </ActionIcon>
      }
    >
      <Flex direction="column" gap="xs">
        <Text size="sm">Filter Group Settings</Text>
        <Divider />

        <Checkbox
          label="Show Distribution"
          labelPosition="left"
          size="xs"
          checked={isDistributionEnabled}
          onChange={e => setDistributionEnabled(e.currentTarget.checked)}
          styles={{
            label: {},
            labelWrapper: {
              width: '100%',
            },
          }}
        />
        <Checkbox
          label="Add to Shared Filters"
          labelPosition="left"
          size="xs"
          styles={{
            label: {},
            labelWrapper: {
              width: '100%',
            },
          }}
        />
      </Flex>
    </FilterSettingsPopover>
  );
}
