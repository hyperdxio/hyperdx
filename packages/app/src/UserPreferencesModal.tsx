import * as React from 'react';
import {
  Autocomplete,
  Badge,
  Button,
  Divider,
  Group,
  Input,
  Modal,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconFlask, IconWorld } from '@tabler/icons-react';

import { OPTIONS_FONTS } from './config/fonts';
import { useAppTheme } from './theme/ThemeProvider';
import { ThemeName } from './theme/types';
import { themes } from './theme';
import { UserPreferences, useUserPreferences } from './useUserPreferences';

const OPTIONS_COLOR_MODE = [
  { label: 'Dark', value: 'dark' },
  { label: 'Light', value: 'light' },
];

// Brand theme options (generated from theme registry)
const OPTIONS_BRAND_THEMES = Object.values(themes).map(t => ({
  label: t.displayName,
  value: t.name,
}));

const OPTIONS_MIX_BLEND_MODE = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plus-darker',
  'plus-lighter',
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
          description="Switch between light and dark mode"
        >
          <Select
            value={userPreferences.theme}
            onChange={value =>
              value &&
              setUserPreference({
                theme: value as UserPreferences['theme'],
              })
            }
            data={OPTIONS_COLOR_MODE}
            allowDeselect={false}
          />
        </SettingContainer>

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
              onChange={value => value && setTheme(value as ThemeName)}
              data={OPTIONS_BRAND_THEMES}
              allowDeselect={false}
            />
          </SettingContainer>
        )}

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

        <SettingContainer label="Background overlay">
          <Switch
            size="md"
            variant="default"
            onClick={() =>
              setUserPreference({
                backgroundEnabled: !userPreferences.backgroundEnabled,
              })
            }
            checked={userPreferences.backgroundEnabled}
          />
        </SettingContainer>

        {userPreferences.backgroundEnabled && (
          <>
            <Divider label={<>Background</>} labelPosition="left" />
            <SettingContainer
              label="Background URL"
              description={
                <Group gap={4}>
                  <Button
                    variant="secondary"
                    size="compact-xs"
                    onClick={() =>
                      setUserPreference({
                        backgroundUrl: 'https://i.imgur.com/CrHYfTG.jpeg',
                      })
                    }
                  >
                    Try this
                  </Button>
                  <Button
                    variant="secondary"
                    size="compact-xs"
                    onClick={() =>
                      setUserPreference({
                        backgroundUrl: 'https://i.imgur.com/hnkdzAX.jpeg',
                      })
                    }
                  >
                    or this
                  </Button>
                </Group>
              }
            >
              <Input
                placeholder="https:// or data:"
                value={userPreferences.backgroundUrl}
                leftSection={<IconWorld size={16} />}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setUserPreference({
                    backgroundUrl: e.currentTarget.value,
                  })
                }
              />
            </SettingContainer>
            <SettingContainer label="Opacity">
              <Slider
                defaultValue={0.1}
                step={0.01}
                max={1}
                min={0}
                value={userPreferences.backgroundOpacity}
                onChange={value =>
                  setUserPreference({
                    backgroundOpacity: value,
                  })
                }
              />
            </SettingContainer>
            <SettingContainer label="Blur">
              <Slider
                defaultValue={0}
                step={0.01}
                max={90}
                min={0}
                value={userPreferences.backgroundBlur}
                onChange={value =>
                  setUserPreference({
                    backgroundBlur: value,
                  })
                }
              />
            </SettingContainer>
            <SettingContainer label="Blend mode">
              <Select
                value={userPreferences.backgroundBlendMode}
                defaultValue="plus-lighter"
                onChange={value =>
                  value &&
                  setUserPreference({
                    backgroundBlendMode:
                      value as UserPreferences['backgroundBlendMode'],
                  })
                }
                data={OPTIONS_MIX_BLEND_MODE}
                allowDeselect={false}
              />
            </SettingContainer>
          </>
        )}
      </Stack>
    </Modal>
  );
};
