import * as React from 'react';
import { useTranslation } from 'react-i18next';
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

import { isSupportedLocale, type Locale } from '@/i18n/config';

import { OPTIONS_FONTS } from './config/fonts';
import { useAppTheme } from './theme/ThemeProvider';
import { isValidThemeName, themes } from './theme';
import { UserPreferences, useUserPreferences } from './useUserPreferences';

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
        {!!description && (
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
  const { t } = useTranslation('settings');
  const { userPreferences, setUserPreference } = useUserPreferences();
  const { themeName, setTheme, isDev } = useAppTheme();
  const colorModeOptions = [
    { label: t('preferences.system'), value: 'system' },
    { label: t('preferences.light'), value: 'light' },
    { label: t('preferences.dark'), value: 'dark' },
  ];
  const localeOptions = [
    { label: t('preferences.english'), value: 'en' },
    { label: t('preferences.korean'), value: 'ko' },
  ] satisfies { label: string; value: Locale }[];

  return (
    <Modal
      title={
        <>
          <span>{t('preferences.title')}</span>
          <Text size="xs" mt={6}>
            {t('preferences.description')}
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
        <SettingContainer label={t('preferences.language')}>
          <Select
            value={userPreferences.locale}
            aria-label={t('preferences.language')}
            onChange={value => {
              if (isSupportedLocale(value)) {
                setUserPreference({ locale: value });
              }
            }}
            data={localeOptions}
            allowDeselect={false}
          />
        </SettingContainer>

        <Divider label={t('preferences.dateTime')} labelPosition="left" />
        <SettingContainer label={t('preferences.timeFormat')}>
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
        <SettingContainer label={t('preferences.useUtc')}>
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
              {t('preferences.appearance')}
              <Badge variant="light" fw="normal" size="xs">
                {t('preferences.experimental')}
              </Badge>
            </Group>
          }
          labelPosition="left"
          mt="sm"
        />
        <SettingContainer
          label={t('preferences.colorMode')}
          description={t('preferences.colorModeDescription')}
        >
          <Select
            value={userPreferences.colorMode}
            onChange={value =>
              value &&
              setUserPreference({
                colorMode: value as UserPreferences['colorMode'],
              })
            }
            data={colorModeOptions}
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
                {t('preferences.brandTheme')}
                <Tooltip
                  label={t('preferences.brandThemeTooltip')}
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
                    {t('preferences.devOnly')}
                  </Badge>
                </Tooltip>
              </Group>
            }
            description={t('preferences.brandThemeDescription')}
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
            label={t('preferences.font')}
            description={t('preferences.fontDescription')}
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
