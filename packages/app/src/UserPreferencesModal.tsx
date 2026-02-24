import * as React from 'react';
import {
  Autocomplete,
  Badge,
  Divider,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconFlask } from '@tabler/icons-react';

import { OPTIONS_FONTS } from './config/fonts';
import { useAppTheme } from './theme/ThemeProvider';
import { isValidThemeName, themes } from './theme';
import { UserPreferences, useUserPreferences } from './useUserPreferences';

const OPTIONS_COLOR_MODE = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

// Brand theme options (generated from theme registry)
const OPTIONS_BRAND_THEMES = Object.values(themes).map(t => ({
  label: t.displayName,
  value: t.name,
}));

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
        {description && (
          <Text size="xs" mt={2}>
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
  const { themeName, setTheme, isDev } = useAppTheme();

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
        <SettingContainer label="Use UTC time">
          <Switch
            size="md"
            onLabel="UTC"
            checked={userPreferences.isUTC}
            onChange={e =>
              setUserPreference({
                isUTC: e.currentTarget.checked,
              })
            }
          />
        </SettingContainer>

        <Divider
          label={
            <Group align="center" gap="xs">
              Appearance
              <Badge variant="light" fw="normal" size="xs">
                Experimental
              </Badge>
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

        {/*
          Brand Theme Selector - DEV MODE ONLY
          
          This is intentionally NOT available in production. Brand theme (HyperDX vs ClickStack)
          is deployment-configured via NEXT_PUBLIC_THEME environment variable.
          Each deployment is branded for a specific product; users don't choose this.
          
          This dev-only UI exists for testing theme implementations during development.
        */}
        {isDev && (
          <SettingContainer
            label={
              <Group gap="xs">
                Brand Theme
                <Tooltip
                  label="Only available in local/dev mode. Changes logo, colors, and branding."
                  multiline
                  w={220}
                >
                  <Badge
                    variant="light"
                    color="violet"
                    fw="normal"
                    size="xs"
                    leftSection={<IconFlask size={10} />}
                  >
                    Dev Only
                  </Badge>
                </Tooltip>
              </Group>
            }
            description="Switch between HyperDX and ClickStack branding"
          >
            <Select
              value={themeName}
              onChange={value => {
                if (value && isValidThemeName(value)) {
                  setTheme(value);
                }
              }}
              data={OPTIONS_BRAND_THEMES}
              allowDeselect={false}
            />
          </SettingContainer>
        )}

        {/* Font selection is only available for HyperDX theme */}
        {/* ClickStack theme always uses Inter font and doesn't show this setting */}
        {themeName !== 'clickstack' && (
          <SettingContainer
            label="Font"
            description="If using custom font, make sure it's installed on your system"
          >
            <Autocomplete
              value={userPreferences.font}
              filter={({ options }) => options}
              onChange={value =>
                setUserPreference({
                  font: value as UserPreferences['font'],
                })
              }
              data={OPTIONS_FONTS}
            />
          </SettingContainer>
        )}
      </Stack>
    </Modal>
  );
};
