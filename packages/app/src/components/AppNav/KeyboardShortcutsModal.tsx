import React from 'react';
import { Divider, Group, Kbd, Modal, Stack, Text } from '@mantine/core';

type ShortcutRow = {
  keys: readonly string[];
  label: string;
  /** Use either key. Default is `chord` (+) for combinations pressed together. */
  keyJoin?: 'or' | 'chord';
};

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['⌘/Ctrl', 'k'], label: 'Open command palette' },
  {
    keys: ['/', 's'],
    label: 'Focus search or WHERE editor',
    keyJoin: 'or',
  },
  { keys: ['d'], label: 'Open time range picker' },
  {
    keys: ['Enter'],
    label: 'Apply custom time range (when time picker is open)',
  },
  { keys: ['⌘/Ctrl', 'f'], label: 'Find in log table' },
  { keys: ['Enter'], label: 'Next find match (find bar open)' },
  { keys: ['Shift', 'Enter'], label: 'Previous find match (find bar open)' },
  {
    keys: ['Esc'],
    label: 'Close panel, drawer, or find bar; clear histogram bucket selection',
  },
  {
    keys: ['←', '→'],
    label: 'Move through events in log table',
    keyJoin: 'or',
  },
  {
    keys: ['↑', '↓'],
    label: 'Move through events in log table',
    keyJoin: 'or',
  },
  {
    keys: ['k', 'j'],
    label: 'Move through events in log table (vim-style)',
    keyJoin: 'or',
  },
  { keys: ['⌘/Ctrl', 'scroll'], label: 'Zoom trace timeline' },
  {
    keys: ['⌥/Alt', 'click'],
    label: 'Collapse span children (trace waterfall)',
  },
  { keys: ['Space'], label: 'Play / pause session replay' },
  {
    keys: ['f'],
    label: 'Toggle chart fullscreen (dashboard) or exit fullscreen view',
  },
  { keys: ['a'], label: 'Toggle chart AI assistant (Charts page)' },
];

export const KeyboardShortcutsModal = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Keyboard Shortcuts"
      size="lg"
      centered
    >
      <Stack gap={0} data-testid="keyboard-shortcuts-modal">
        {SHORTCUTS.map(({ keys, label, keyJoin = 'chord' }, rowIndex) => (
          <React.Fragment key={rowIndex}>
            <Group justify="space-between" wrap="nowrap" gap="md" py="sm">
              <Group gap={4} wrap="nowrap">
                {keys.map((key, i) => (
                  <React.Fragment key={`${rowIndex}-${i}-${key}`}>
                    {i > 0 && (
                      <Text span size="xs" c="dimmed" tt="lowercase" px={2}>
                        {keyJoin === 'or' ? 'or' : '+'}
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
            {rowIndex < SHORTCUTS.length - 1 ? <Divider /> : null}
          </React.Fragment>
        ))}
      </Stack>
    </Modal>
  );
};
