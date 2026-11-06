import * as React from 'react';
import { Badge } from '@clickhouse/click-ui';
import { Divider, Group, Modal, Select, Stack, Text } from '@mantine/core';

import { TimeZoneSelect, TimeZoneShortcuts } from './components/TimeZoneSelect';
import { isContentFontSize, OPTIONS_CONTENT_FONT_SIZE } from './config/fonts';
import {
  DEFAULT_ROW_CLICK_ACTION,
  RowClickAction,
  useContentFontSize,
  UserPreferences,
  useUserPreferences,
} from './useUserPreferences';

const OPTIONS_COLOR_MODE = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

const OPTIONS_ROW_CLICK_ACTION: { label: string; value: RowClickAction }[] = [
  { label: 'Open side panel', value: 'sidePanel' },
  { label: 'Expand inline', value: 'expand' },
];

const SettingContainer = ({
  label,
  description,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) => {
  return (
    <Group align="center" justify="space-between">
      <div style={{ flex: 1 }}>
        {label}
        {!!description && (
          <Text size="xs" mt={2} c="var(--color-text-muted)">
            {description}
          </Text>
        )}
      </div>
      <div style={{ flex: 0.8 }}>{children}</div>
    </Group>
  );
};

export const UserPreferencesModal = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  const { userPreferences, setUserPreference } = useUserPreferences();
  const { contentFontSize } = useContentFontSize();

  return (
    <Modal
      title={
        <>
          <span>Preferences</span>
          <Text size="xs" mt={6}>
            Customize your experience
          </Text>
        </>
      }
      size="lg"
      padding="lg"
      keepMounted={false}
      opened={opened}
      onClose={onClose}
    >
      <Stack gap="lg">
        <Divider label="Date and Time" labelPosition="left" />
        <SettingContainer label="Time format">
          <Select
            value={userPreferences.timeFormat}
            onChange={value =>
              value &&
              setUserPreference({
                timeFormat: value as UserPreferences['timeFormat'],
              })
            }
            data={['12h', '24h']}
            allowDeselect={false}
          />
        </SettingContainer>
        <SettingContainer
          label="Time zone"
          description="Times are displayed and input in this zone."
        >
          <Stack gap={4}>
            <TimeZoneSelect
              data-testid="time-zone-select"
              value={userPreferences.timeZone}
              onChange={timeZone => timeZone && setUserPreference({ timeZone })}
            />
            <TimeZoneShortcuts
              testIdPrefix="time-zone"
              onSelect={timeZone => setUserPreference({ timeZone })}
            />
          </Stack>
        </SettingContainer>

        <Divider label="Search results" labelPosition="left" mt="sm" />
        <SettingContainer
          label="Row click"
          description="What clicking a result row does. The chevron always expands inline."
        >
          <Select
            data-testid="row-click-action-select"
            value={userPreferences.rowClickAction ?? DEFAULT_ROW_CLICK_ACTION}
            onChange={value => {
              const option = OPTIONS_ROW_CLICK_ACTION.find(
                o => o.value === value,
              );
              if (option) {
                setUserPreference({ rowClickAction: option.value });
              }
            }}
            data={OPTIONS_ROW_CLICK_ACTION}
            allowDeselect={false}
          />
        </SettingContainer>

        <Divider
          label={
            <Group align="center" gap="xs">
              Appearance
              <Badge size="sm" text="Experimental" state="info" />
            </Group>
          }
          labelPosition="left"
          mt="sm"
        />
        <SettingContainer
          label="Color Mode"
          description="Use system setting, or choose light or dark"
        >
          <Select
            value={userPreferences.colorMode}
            onChange={value =>
              value &&
              setUserPreference({
                colorMode: value as UserPreferences['colorMode'],
              })
            }
            data={OPTIONS_COLOR_MODE}
            allowDeselect={false}
          />
        </SettingContainer>

        <SettingContainer
          label="Content font size"
          description="Text size for log tables, data tables, and charts"
        >
          <Select
            data-testid="content-font-size-select"
            value={contentFontSize}
            onChange={value =>
              value &&
              isContentFontSize(value) &&
              setUserPreference({ contentFontSize: value })
            }
            data={OPTIONS_CONTENT_FONT_SIZE}
            allowDeselect={false}
          />
        </SettingContainer>
      </Stack>
    </Modal>
  );
};
