import React from 'react';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Divider, Group, Kbd, Modal, Stack, Text } from '@mantine/core';

type ShortcutRow = {
  keys: readonly string[];
  label: string;
  /** Use either key. Default is `chord` (+) for combinations pressed together. */
  keyJoin?: 'or' | 'chord';
};

const getShortcuts = (t: TFunction<'navigation'>): ShortcutRow[] => [
  { keys: ['⌘/Ctrl', 'k'], label: t('shortcuts.openPalette') },
  {
    keys: ['/', 's'],
    label: t('shortcuts.focusSearch'),
    keyJoin: 'or',
  },
  { keys: ['d'], label: t('shortcuts.openTimePicker') },
  {
    keys: ['Enter'],
    label: t('shortcuts.applyTimeRange'),
  },
  { keys: ['⌘/Ctrl', 'f'], label: t('shortcuts.findLogs') },
  { keys: ['Enter'], label: t('shortcuts.nextFind') },
  { keys: ['Shift', 'Enter'], label: t('shortcuts.previousFind') },
  {
    keys: ['Esc'],
    label: t('shortcuts.close'),
  },
  {
    keys: ['←', '→'],
    label: t('shortcuts.moveEvents'),
    keyJoin: 'or',
  },
  {
    keys: ['↑', '↓'],
    label: t('shortcuts.moveEvents'),
    keyJoin: 'or',
  },
  {
    keys: ['k', 'j'],
    label: t('shortcuts.moveEventsVim'),
    keyJoin: 'or',
  },
  { keys: ['⌘/Ctrl', 'scroll'], label: t('shortcuts.zoomTrace') },
  {
    keys: ['⌥/Alt', 'click'],
    label: t('shortcuts.collapseSpan'),
  },
  { keys: ['Space'], label: t('shortcuts.replay') },
  {
    keys: ['f'],
    label: t('shortcuts.fullscreen'),
  },
  { keys: ['a'], label: t('shortcuts.chartAi') },
  {
    keys: ['Shift', 'click'],
    label: t('shortcuts.selectTile'),
  },
  { keys: ['⌘/Ctrl', 'g'], label: t('shortcuts.groupTiles') },
];

export const KeyboardShortcutsModal = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  const { t } = useTranslation('navigation');
  const shortcuts = getShortcuts(t);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('shortcuts.title')}
      size="lg"
      centered
    >
      <Stack gap={0} data-testid="keyboard-shortcuts-modal">
        {shortcuts.map(({ keys, label, keyJoin = 'chord' }, rowIndex) => (
          <React.Fragment key={rowIndex}>
            <Group justify="space-between" wrap="nowrap" gap="md" py="sm">
              <Group gap={4} wrap="nowrap">
                {keys.map((key, i) => (
                  <React.Fragment key={`${rowIndex}-${i}-${key}`}>
                    {i > 0 && (
                      <Text span size="xs" c="dimmed" tt="lowercase" px={2}>
                        {keyJoin === 'or' ? t('shortcuts.or') : '+'}
                      </Text>
                    )}
                    <Kbd size="xs">{key}</Kbd>
                  </React.Fragment>
                ))}
              </Group>
              <Text size="sm" maw="58%" ta="right">
                {label}
              </Text>
            </Group>
            {rowIndex < shortcuts.length - 1 ? <Divider /> : null}
          </React.Fragment>
        ))}
      </Stack>
    </Modal>
  );
};
