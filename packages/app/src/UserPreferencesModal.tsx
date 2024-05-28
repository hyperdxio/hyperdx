import * as React from 'react';
import {
  Autocomplete,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Input,
  Modal,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
} from '@mantine/core';

import { UserPreferences, useUserPreferences } from './useUserPreferences';

const OPTIONS_FONTS = [
  'IBM Plex Mono',
  'Roboto Mono',
  'Inter',
  { value: 'or use your own font', disabled: true },
];

const OPTIONS_THEMES = [
  { label: 'Dark', value: 'dark' },
  { label: 'Fake Light', value: 'light' },
];

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
          <Text c="gray.6" size="xs" mt={2}>
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

  return (
    <Modal
      title={
        <>
          <span>Preferences</span>
          <Text size="xs" c="gray.6" mt={6}>
            Customize your experience
          </Text>
        </>
      }
      centered
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
          label="Theme"
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
            data={OPTIONS_THEMES}
            allowDeselect={false}
          />
        </SettingContainer>

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

        <Divider label="Background" labelPosition="left" />

        <SettingContainer
          label="Background URL"
          description={
            <Group gap={4}>
              <Button
                variant="light"
                color="gray"
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
                variant="light"
                color="gray"
                size="compact-xs"
                onClick={() =>
                  setUserPreference({
                    backgroundUrl: 'https://i.imgur.com/hnkdzAX.jpeg',
                  })
                }
              >
                or this
              </Button>
              <Button
                variant="light"
                color="gray"
                size="compact-xs"
                onClick={() =>
                  setUserPreference({
                    backgroundUrl: `https://source.unsplash.com/random?random=${Math.random()}`,
                  })
                }
              >
                or random
              </Button>
            </Group>
          }
        >
          <Input
            placeholder="https:// or data:"
            value={userPreferences.backgroundUrl}
            leftSection={<i className="bi bi-globe" />}
            onChange={e =>
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
            defaultValue="screen"
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
      </Stack>
    </Modal>
  );
};
