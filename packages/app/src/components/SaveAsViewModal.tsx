import { useEffect, useState } from 'react';
import {
  ListViewResource,
  ListViewRule,
} from '@hyperdx/common-utils/dist/types';
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { useCreateListView } from '@/listView';

/**
 * Active-filter snapshot that the listing page hands to the modal.
 * Each truthy field becomes one rule on the persisted view. The
 * combinator is fixed to `all` here (chips + pills both narrow);
 * the advanced drawer is the entry point for `any`.
 */
export type SaveAsViewFilters = {
  tags: string[];
  recentDays: number | null;
  withAlerts: boolean | null;
  createdByMe: boolean | null;
};

export function buildRulesFromFilters(
  filters: SaveAsViewFilters,
): ListViewRule[] {
  const rules: ListViewRule[] = [];
  for (const tag of filters.tags) {
    rules.push({ kind: 'tag-includes', tag });
  }
  if (filters.recentDays && filters.recentDays > 0) {
    rules.push({ kind: 'updated-within-days', days: filters.recentDays });
  }
  if (filters.withAlerts) {
    rules.push({ kind: 'has-active-alerts' });
  }
  if (filters.createdByMe) {
    rules.push({ kind: 'created-by-me' });
  }
  return rules;
}

export function SaveAsViewModal({
  opened,
  onClose,
  resource,
  filters,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  resource: ListViewResource;
  filters: SaveAsViewFilters;
  /** Called with the new view id after a successful save. The
   *  listing uses this to clear the active filters and route to
   *  the new view via ?view=<id>. */
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const createListView = useCreateListView();

  useEffect(() => {
    if (!opened) return;
    setName('');
    setIcon('');
    setNameError(null);
  }, [opened]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Name is required');
      return;
    }
    setNameError(null);

    const rules = buildRulesFromFilters(filters);

    createListView.mutate(
      {
        name: trimmed,
        icon: icon.trim() || undefined,
        resource,
        rules,
        combinator: 'all',
        ordering: 0,
      },
      {
        onSuccess: data => {
          notifications.show({
            message: 'View saved',
            color: 'green',
          });
          onSaved(data.id);
          onClose();
        },
        onError: () => {
          notifications.show({
            message: 'Failed to save view',
            color: 'red',
          });
        },
      },
    );
  };

  const ruleCount = buildRulesFromFilters(filters).length;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Save current filters as a view"
      data-testid="save-as-view-modal"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Pins these {ruleCount} filter{ruleCount === 1 ? '' : 's'} to the left
          rail so you can jump back with one click.
        </Text>
        <TextInput
          label="Name"
          required
          value={name}
          onChange={e => {
            const next = e.currentTarget.value;
            setName(next);
          }}
          placeholder="e.g. Checkout team"
          error={nameError}
          maxLength={120}
          data-testid="save-as-view-name-input"
        />
        <TextInput
          label="Icon (optional)"
          description="An emoji or short label rendered next to the name."
          value={icon}
          onChange={e => {
            const next = e.currentTarget.value;
            setIcon(next);
          }}
          placeholder="🛒"
          maxLength={64}
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={createListView.isPending}
            data-testid="save-as-view-button"
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
