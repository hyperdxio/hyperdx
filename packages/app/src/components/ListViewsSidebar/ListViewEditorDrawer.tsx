import { useEffect, useMemo, useState } from 'react';
import {
  ListViewCombinator,
  ListViewResource,
  ListViewRule,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Drawer,
  Group,
  NumberInput,
  Pill,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';

import {
  type ListView,
  useCreateListView,
  useUpdateListView,
} from '@/listView';

type RuleDraft =
  | { kind: 'tag-includes'; tag: string }
  | { kind: 'tag-excludes'; tag: string }
  | { kind: 'untagged' }
  | { kind: 'updated-within-days'; days: number }
  | { kind: 'has-active-alerts' }
  | { kind: 'created-by-me' };

const RULE_KIND_LABEL: Record<RuleDraft['kind'], string> = {
  'tag-includes': 'tag includes',
  'tag-excludes': 'tag excludes',
  untagged: 'is untagged',
  'updated-within-days': 'updated within',
  'has-active-alerts': 'has active alerts',
  'created-by-me': 'created by me',
};

const RECENT_PRESETS = [1, 7, 30];

const DEFAULT_DRAFT: {
  name: string;
  icon: string;
  combinator: ListViewCombinator;
  rules: RuleDraft[];
} = {
  name: '',
  icon: '',
  combinator: 'all',
  rules: [{ kind: 'tag-includes', tag: '' }],
};

export function ListViewEditorDrawer({
  opened,
  onClose,
  resource,
  existingView,
  availableTags,
}: {
  opened: boolean;
  onClose: () => void;
  resource: ListViewResource;
  existingView?: ListView;
  availableTags: string[];
}) {
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [nameError, setNameError] = useState<string | null>(null);

  const createListView = useCreateListView();
  const updateListView = useUpdateListView();

  // Seed the draft from the existing view when the drawer opens for
  // editing; reset to defaults when opening for a new view.
  //
  // Defensive on every field: an older ListView document stored before
  // the local-mode default kicked in (or returned by a server that
  // dropped a field) may have `rules` undefined, `combinator` missing,
  // or any rule entry null. Coerce to safe defaults rather than letting
  // `.length` / `.tag` throw and crash the whole listing page.
  useEffect(() => {
    if (!opened) return;
    if (existingView) {
      const safeRules = Array.isArray(existingView.rules)
        ? (existingView.rules.filter(
            (r): r is RuleDraft => r != null && typeof r === 'object',
          ) as RuleDraft[])
        : [];
      setDraft({
        name: existingView.name ?? '',
        icon: existingView.icon ?? '',
        combinator: existingView.combinator ?? 'all',
        rules:
          safeRules.length > 0
            ? safeRules
            : [{ kind: 'tag-includes', tag: '' }],
      });
    } else {
      setDraft(DEFAULT_DRAFT);
    }
    setNameError(null);
  }, [opened, existingView]);

  const isPending = createListView.isPending || updateListView.isPending;

  const tagOptions = useMemo(
    () => availableTags.map(t => ({ value: t, label: t })),
    [availableTags],
  );

  const updateRule = (index: number, next: RuleDraft) => {
    setDraft(d => {
      const rules = d.rules.slice();
      rules[index] = next;
      return { ...d, rules };
    });
  };

  const removeRule = (index: number) => {
    setDraft(d => ({
      ...d,
      rules: d.rules.filter((_, i) => i !== index),
    }));
  };

  const addRule = () => {
    setDraft(d => ({
      ...d,
      rules: [...d.rules, { kind: 'tag-includes', tag: '' }],
    }));
  };

  const handleSave = () => {
    const name = draft.name.trim();
    if (!name) {
      setNameError('Name is required');
      return;
    }
    setNameError(null);

    // Drop any draft rules that are missing required fields (e.g. a
    // tag-includes row left with an empty tag, or an
    // updated-within-days row with a non-positive day count). Saving an
    // empty list is allowed: a view with no rules matches everything,
    // which matches the "pin" semantics of bookmarking the current
    // state.
    const rules: ListViewRule[] = draft.rules.filter(r => {
      if (r.kind === 'tag-includes' || r.kind === 'tag-excludes') {
        return r.tag.trim().length > 0;
      }
      if (r.kind === 'updated-within-days') {
        return Number.isFinite(r.days) && r.days >= 1 && r.days <= 365;
      }
      return true;
    });

    const payload = {
      name,
      icon: draft.icon.trim() || undefined,
      resource,
      rules,
      combinator: draft.combinator,
      ordering: existingView?.ordering ?? 0,
    };

    const onSuccess = () => {
      notifications.show({
        message: existingView ? 'View updated' : 'View created',
        color: 'green',
      });
      onClose();
    };
    const onError = () => {
      notifications.show({
        message: existingView
          ? 'Failed to update view'
          : 'Failed to create view',
        color: 'red',
      });
    };

    if (existingView) {
      updateListView.mutate(
        { id: existingView.id, patch: payload },
        { onSuccess, onError },
      );
    } else {
      createListView.mutate(payload, { onSuccess, onError });
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      title={existingView ? 'Edit View' : 'New View'}
      data-testid="list-view-editor-drawer"
    >
      <Stack gap="md">
        <TextInput
          label="Name"
          required
          value={draft.name}
          onChange={e => {
            // Capture the value EAGERLY: React 18 nulls out
            // `event.currentTarget` after the synthetic-event handler
            // returns, so reading `e.currentTarget.value` inside a
            // deferred state updater throws `Cannot read properties
            // of null (reading 'value')` under concurrent rendering.
            // Same pattern matters for every TextInput onChange that
            // pipes through a `setState(prev => ...)` updater.
            const nextName = e.currentTarget.value;
            setDraft(d => ({ ...d, name: nextName }));
          }}
          placeholder="e.g. Checkout team"
          error={nameError}
          data-testid="list-view-name-input"
        />

        <TextInput
          label="Icon (optional)"
          description="An emoji or short label rendered next to the name."
          value={draft.icon}
          onChange={e => {
            const nextIcon = e.currentTarget.value;
            setDraft(d => ({ ...d, icon: nextIcon }));
          }}
          placeholder="🛒"
          maxLength={64}
        />

        <Radio.Group
          label="Match"
          description="How to combine the rules below."
          value={draft.combinator}
          onChange={value =>
            setDraft(d => ({
              ...d,
              combinator: value as ListViewCombinator,
            }))
          }
        >
          <Group gap="md" mt="xs">
            <Radio value="all" label="All rules" />
            <Radio value="any" label="Any rule" />
          </Group>
        </Radio.Group>

        <Box>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={500}>
              Rules
            </Text>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={addRule}
              data-testid="add-list-view-rule"
            >
              Add rule
            </Button>
          </Group>
          <Stack gap="xs">
            {draft.rules.length === 0 ? (
              <Text size="xs" c="dimmed">
                No rules; this view will match every {resource}.
              </Text>
            ) : (
              draft.rules.map((rule, i) => (
                <Group
                  key={i}
                  gap="xs"
                  wrap="nowrap"
                  data-testid={`list-view-rule-${i}`}
                >
                  <Select
                    data={[
                      {
                        value: 'tag-includes',
                        label: RULE_KIND_LABEL['tag-includes'],
                      },
                      {
                        value: 'tag-excludes',
                        label: RULE_KIND_LABEL['tag-excludes'],
                      },
                      {
                        value: 'untagged',
                        label: RULE_KIND_LABEL.untagged,
                      },
                      {
                        value: 'updated-within-days',
                        label: RULE_KIND_LABEL['updated-within-days'],
                      },
                      {
                        value: 'has-active-alerts',
                        label: RULE_KIND_LABEL['has-active-alerts'],
                      },
                      {
                        value: 'created-by-me',
                        label: RULE_KIND_LABEL['created-by-me'],
                      },
                    ]}
                    value={rule.kind}
                    onChange={value => {
                      if (!value) return;
                      const kind = value as RuleDraft['kind'];
                      switch (kind) {
                        case 'untagged':
                        case 'has-active-alerts':
                        case 'created-by-me':
                          updateRule(i, { kind });
                          return;
                        case 'updated-within-days':
                          updateRule(i, { kind, days: 7 });
                          return;
                        case 'tag-includes':
                        case 'tag-excludes':
                          updateRule(i, {
                            kind,
                            tag: 'tag' in rule ? rule.tag : '',
                          });
                          return;
                      }
                    }}
                    w={170}
                  />
                  {(rule.kind === 'tag-includes' ||
                    rule.kind === 'tag-excludes') && (
                    <Select
                      data={tagOptions}
                      value={rule.tag || null}
                      onChange={value =>
                        updateRule(i, { ...rule, tag: value ?? '' })
                      }
                      placeholder="Select tag"
                      searchable
                      style={{ flex: 1 }}
                      data-testid={`list-view-rule-tag-${i}`}
                    />
                  )}
                  {rule.kind === 'updated-within-days' && (
                    <Group gap="xs" wrap="nowrap" style={{ flex: 1 }}>
                      <NumberInput
                        value={rule.days}
                        onChange={value => {
                          const days =
                            typeof value === 'number' ? value : Number(value);
                          updateRule(i, {
                            kind: 'updated-within-days',
                            days: Number.isFinite(days) ? days : 7,
                          });
                        }}
                        min={1}
                        max={365}
                        step={1}
                        w={90}
                        data-testid={`list-view-rule-days-${i}`}
                      />
                      <Text size="sm" c="dimmed">
                        days
                      </Text>
                      <Pill.Group>
                        {RECENT_PRESETS.map(d => (
                          <Pill
                            key={d}
                            withRemoveButton={false}
                            onClick={() =>
                              updateRule(i, {
                                kind: 'updated-within-days',
                                days: d,
                              })
                            }
                            style={{
                              cursor: 'pointer',
                              backgroundColor:
                                rule.days === d
                                  ? 'var(--mantine-color-default-hover)'
                                  : undefined,
                            }}
                            data-testid={`list-view-rule-days-preset-${i}-${d}`}
                          >
                            {d}
                          </Pill>
                        ))}
                      </Pill.Group>
                    </Group>
                  )}
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => removeRule(i)}
                    aria-label="Remove rule"
                    data-testid={`remove-list-view-rule-${i}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))
            )}
          </Stack>
        </Box>

        <Group justify="flex-end" mt="md">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={isPending}
            data-testid="save-list-view-button"
          >
            {existingView ? 'Save' : 'Create'}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
