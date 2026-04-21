import { useState } from 'react';
import {
  ActionIcon,
  Checkbox,
  Divider,
  Flex,
  Popover,
  Text,
  Tooltip,
  UnstyledButton,
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
    <Popover width={250} trapFocus position="right" withArrow shadow="md">
      <Popover.Target>{target}</Popover.Target>
      <Popover.Dropdown>{children}</Popover.Dropdown>
    </Popover>
  );
}

/**
 * Global filter settings gear icon — shown next to the "Filters" header.
 * Controls visibility of the shared filters section and filter counts.
 */
export function FilterSettingsPanel({
  isSharedFiltersVisible,
  onSharedFiltersVisibilityChange,
  showFilterCounts,
  onShowFilterCountsChange,
  hasPersonalPins,
  onResetPersonalPins,
  hasSharedPins,
  onResetSharedFilters,
}: {
  isSharedFiltersVisible: boolean;
  onSharedFiltersVisibilityChange: (visible: boolean) => void;
  showFilterCounts: boolean;
  onShowFilterCountsChange: (show: boolean) => void;
  hasPersonalPins: boolean;
  onResetPersonalPins: VoidFunction;
  hasSharedPins: boolean;
  onResetSharedFilters: VoidFunction;
}) {
  const showResetSection = hasPersonalPins || hasSharedPins;

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
          styles={{ labelWrapper: { width: '100%' } }}
          checked={isSharedFiltersVisible}
          onChange={e =>
            onSharedFiltersVisibilityChange(e.currentTarget.checked)
          }
        />
        <Checkbox
          label="Show Applied Filter Counts"
          labelPosition="left"
          size="xs"
          styles={{ labelWrapper: { width: '100%' } }}
          checked={showFilterCounts}
          onChange={e => onShowFilterCountsChange(e.currentTarget.checked)}
        />
        {showResetSection && (
          <>
            <Divider />
            {hasPersonalPins && (
              <ResetAction
                label="Reset My Pins"
                confirmationText="This will clear your personal pinned filters."
                onReset={onResetPersonalPins}
              />
            )}
            {hasSharedPins && (
              <ResetAction
                label="Reset Shared Filters"
                confirmationText="This will clear all shared filters for the entire team."
                onReset={onResetSharedFilters}
              />
            )}
          </>
        )}
      </Flex>
    </SettingsPopover>
  );
}

function ResetAction({
  label,
  confirmationText,
  onReset,
}: {
  label: string;
  confirmationText: string;
  onReset: VoidFunction;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <Flex direction="column" gap={4}>
        <Text size="xs" c="yellow">
          {confirmationText}
        </Text>
        <Flex gap="xs">
          <UnstyledButton
            onClick={() => {
              onReset();
              setConfirming(false);
            }}
          >
            <Text size="xs" c="red" fw={500}>
              Confirm
            </Text>
          </UnstyledButton>
          <UnstyledButton onClick={() => setConfirming(false)}>
            <Text size="xs" c="dimmed">
              Cancel
            </Text>
          </UnstyledButton>
        </Flex>
      </Flex>
    );
  }

  return (
    <UnstyledButton onClick={() => setConfirming(true)}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </UnstyledButton>
  );
}
