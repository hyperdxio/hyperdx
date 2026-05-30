import { useEffect, useMemo, useState } from 'react';
import {
  SmartViewCombinator,
  SmartViewResource,
  SmartViewTagRule,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Drawer,
  Group,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';

import {
  type SmartView,
  useCreateSmartView,
  useUpdateSmartView,
} from '@/smartView';

type RuleDraft =
  | { kind: 'tag-includes'; tag: string }
  | { kind: 'tag-excludes'; tag: string }
  | { kind: 'untagged' };

const RULE_KIND_LABEL: Record<RuleDraft['kind'], string> = {
  'tag-includes': 'tag includes',
  'tag-excludes': 'tag excludes',
  untagged: 'is untagged',
};

const DEFAULT_DRAFT: {
  name: string;
  icon: string;
  combinator: SmartViewCombinator;
  rules: RuleDraft[];
} = {
  name: '',
  icon: '',
  combinator: 'all',
  rules: [{ kind: 'tag-includes', tag: '' }],
};

export function SmartViewEditorDrawer({
  opened,
  onClose,
  resource,
  existingView,
  availableTags,
}: {
  opened: boolean;
  onClose: () => void;
  resource: SmartViewResource;
  existingView?: SmartView;
  availableTags: string[];
}) {
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [nameError, setNameError] = useState<string | null>(null);

  const createSmartView = useCreateSmartView();
  const updateSmartView = useUpdateSmartView();

  // Seed the draft from the existing view when the drawer opens for
  // editing; reset to defaults when opening for a new view.
  useEffect(() => {
    if (!opened) return;
    if (existingView) {
      setDraft({
        name: existingView.name,
        icon: existingView.icon ?? '',
        combinator: existingView.combinator,
        rules:
          existingView.rules.length > 0
            ? (existingView.rules as RuleDraft[])
            : [{ kind: 'tag-includes', tag: '' }],
      });
    } else {
      setDraft(DEFAULT_DRAFT);
    }
    setNameError(null);
  }, [opened, existingView]);

  const isPending = createSmartView.isPending || updateSmartView.isPending;

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
    // tag-includes row left with an empty tag). Saving an empty list
    // is allowed: a view with no rules matches everything, which
    // matches the "pin" semantics of bookmarking the current state.
    const rules: SmartViewTagRule[] = draft.rules.filter(r => {
      if (r.kind === 'untagged') return true;
      return r.tag.trim().length > 0;
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
        message: existingView ? 'Smart view updated' : 'Smart view created',
        color: 'green',
      });
      onClose();
    };
    const onError = () => {
      notifications.show({
        message: existingView
          ? 'Failed to update smart view'
          : 'Failed to create smart view',
        color: 'red',
      });
    };

    if (existingView) {
      updateSmartView.mutate(
        { id: existingView.id, patch: payload },
        { onSuccess, onError },
      );
    } else {
      createSmartView.mutate(payload, { onSuccess, onError });
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      title={existingView ? 'Edit Smart View' : 'New Smart View'}
      data-testid="smart-view-editor-drawer"
    >
      <Stack gap="md">
        <TextInput
          label="Name"
          required
          value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.currentTarget.value }))}
          placeholder="e.g. Checkout team"
          error={nameError}
          data-testid="smart-view-name-input"
        />

        <TextInput
          label="Icon (optional)"
          description="An emoji or short label rendered next to the name."
          value={draft.icon}
          onChange={e => setDraft(d => ({ ...d, icon: e.currentTarget.value }))}
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
              combinator: value as SmartViewCombinator,
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
              data-testid="add-smart-view-rule"
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
                  data-testid={`smart-view-rule-${i}`}
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
                    ]}
                    value={rule.kind}
                    onChange={value => {
                      if (!value) return;
                      const kind = value as RuleDraft['kind'];
                      if (kind === 'untagged') {
                        updateRule(i, { kind: 'untagged' });
                      } else {
                        updateRule(i, {
                          kind,
                          tag: 'tag' in rule ? rule.tag : '',
                        });
                      }
                    }}
                    w={150}
                  />
                  {rule.kind !== 'untagged' && (
                    <Select
                      data={tagOptions}
                      value={rule.tag || null}
                      onChange={value =>
                        updateRule(i, { ...rule, tag: value ?? '' })
                      }
                      placeholder="Select tag"
                      searchable
                      style={{ flex: 1 }}
                      data-testid={`smart-view-rule-tag-${i}`}
                    />
                  )}
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => removeRule(i)}
                    aria-label="Remove rule"
                    data-testid={`remove-smart-view-rule-${i}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))
            )}
          </Stack>
        </Box>

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={isPending}
            data-testid="save-smart-view-button"
          >
            {existingView ? 'Save' : 'Create'}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
