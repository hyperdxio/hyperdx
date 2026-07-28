import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  showAllValues,
  onShowAllValuesChange,
}: {
  isSharedFiltersVisible: boolean;
  onSharedFiltersVisibilityChange: (visible: boolean) => void;
  showFilterCounts: boolean;
  onShowFilterCountsChange: (show: boolean) => void;
  hasPersonalPins: boolean;
  onResetPersonalPins: VoidFunction;
  hasSharedPins: boolean;
  onResetSharedFilters: VoidFunction;
  showAllValues: boolean;
  onShowAllValuesChange: (show: boolean) => void;
}) {
  const { t } = useTranslation('search');
  const showResetSection = hasPersonalPins || hasSharedPins;

  return (
    <SettingsPopover
      target={
        <Tooltip
          label={t('filters.settings')}
          position="top"
          withArrow
          fz="xxs"
          color="gray"
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            aria-label={t('filters.settings')}
          >
            <IconSettings size={14} />
          </ActionIcon>
        </Tooltip>
      }
    >
      <Flex direction="column" gap="xs">
        <Text size="sm" fw={500}>
          {t('filters.settings')}
        </Text>
        <Divider />
        <Checkbox
          label={t('filters.showShared')}
          labelPosition="left"
          size="xs"
          styles={{ labelWrapper: { width: '100%' } }}
          checked={isSharedFiltersVisible}
          onChange={e =>
            onSharedFiltersVisibilityChange(e.currentTarget.checked)
          }
        />
        <Checkbox
          label={t('filters.showCounts')}
          labelPosition="left"
          size="xs"
          styles={{ labelWrapper: { width: '100%' } }}
          checked={showFilterCounts}
          onChange={e => onShowFilterCountsChange(e.currentTarget.checked)}
        />
        <Tooltip
          label={t('filters.showAllValuesDescription')}
          multiline
          w={220}
          position="bottom"
          withArrow
          fz="xxs"
          color="gray"
        >
          <Checkbox
            label={t('filters.showAllValues')}
            labelPosition="left"
            size="xs"
            styles={{ labelWrapper: { width: '100%' } }}
            checked={showAllValues}
            onChange={e => onShowAllValuesChange(e.currentTarget.checked)}
          />
        </Tooltip>
        {showResetSection && (
          <>
            <Divider />
            {hasPersonalPins && (
              <ResetAction
                label={t('filters.resetMyPins')}
                confirmationText={t('filters.resetMyPinsConfirmation')}
                onReset={onResetPersonalPins}
              />
            )}
            {hasSharedPins && (
              <ResetAction
                label={t('filters.resetShared')}
                confirmationText={t('filters.resetSharedConfirmation')}
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
  const { t } = useTranslation('search');
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
              {t('filters.confirm')}
            </Text>
          </UnstyledButton>
          <UnstyledButton onClick={() => setConfirming(false)}>
            <Text size="xs" c="dimmed">
              {t('filters.cancel')}
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
