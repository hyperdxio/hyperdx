import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  ActionIcon,
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Code,
  Flex,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import { IconX } from '@tabler/icons-react';

import { InlineNameInput, InlineNameInputControlled } from './InlineNameInput';

const meta: Meta<typeof InlineNameInput> = {
  title: 'Components/InlineNameInput',
  component: InlineNameInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The one way to name a user-created object. See Guidelines/Naming objects for when to use each variant.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof InlineNameInput>;

function SavedObjectDemo({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [log, setLog] = useState<string[]>([]);
  return (
    <Stack gap="xs">
      <Breadcrumbs fz="sm">
        <Anchor fz="sm" c="dimmed">
          Dashboards
        </Anchor>
        <Text fz="sm" c="dimmed">
          {name || 'Untitled'}
        </Text>
      </Breadcrumbs>
      <InlineNameInput
        value={name}
        onCommit={next => {
          setName(next);
          setLog(l => [...l, `Saved "${next}"`]);
        }}
        placeholder="Untitled dashboard"
        aria-label="Dashboard name"
        size="md"
        headingLevel={3}
      />
      <Text size="xs" c="dimmed">
        Hover, then click to edit. Enter or click away saves; Escape reverts.
      </Text>
      {log.length > 0 && <Code block>{log.join('\n')}</Code>}
    </Stack>
  );
}

/** A saved object: the rename is saved as soon as it is committed. */
export const SavedObject: Story = {
  render: () => <SavedObjectDemo initialName="Checkout service" />,
};

/** A saved object with a name long enough to truncate at rest. */
export const LongName: Story = {
  render: () => (
    <Box maw={360}>
      <SavedObjectDemo initialName="Payments API latency and error budget by region (production)" />
    </Box>
  ),
};

function DraftEditorDemo() {
  const { control, handleSubmit, reset } = useForm({
    defaultValues: { name: '' },
  });
  const name = useWatch({ control, name: 'name' });
  const [saved, setSaved] = useState<string>();
  return (
    <Stack gap="md">
      <Flex
        align="center"
        justify="space-between"
        gap="md"
        h={64}
        px="md"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <Group gap="sm" wrap="nowrap" miw={0}>
          <ActionIcon
            variant="secondary"
            size="input-sm"
            aria-label="Close editor"
            onClick={() => reset()}
          >
            <IconX size={16} />
          </ActionIcon>
          <InlineNameInputControlled
            control={control}
            name="name"
            size="sm"
            placeholder="Untitled tile"
            aria-label="Tile name"
          />
        </Group>
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Add to{' '}
            <Text span inherit c="var(--color-text)" fw={500}>
              My dashboard
            </Text>
          </Text>
          <Button
            variant="primary"
            onClick={handleSubmit(v => setSaved(v.name || 'Untitled tile'))}
          >
            Add to dashboard
          </Button>
        </Group>
      </Flex>
      <Text size="xs" c="dimmed" px="md">
        Draft name: <Code>{name || '(empty)'}</Code>
        {saved != null && (
          <>
            {' '}
            · Saved: <Code>{saved}</Code>
          </>
        )}
      </Text>
    </Stack>
  );
}

/**
 * A draft in an editor: the name is part of the form and only saves with the
 * editor's save button.
 */
export const DraftInEditorHeader: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <DraftEditorDemo />,
};

const SIZE_USAGE: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'Compact rows, e.g. inside a form',
  sm: 'Editor headers (default)',
  md: 'Page titles',
};

const SIZES: Array<'xs' | 'sm' | 'md'> = ['xs', 'sm', 'md'];

/** Every size, filled and empty. */
export const Sizes: Story = {
  render: () => (
    <Stack gap="lg">
      {SIZES.map(size => (
        <Stack key={size} gap={4}>
          <Text size="xs" c="dimmed">
            size=&quot;{size}&quot; · {SIZE_USAGE[size]}
          </Text>
          <InlineNameInput
            size={size}
            value="Error rate by service"
            onCommit={() => {}}
            aria-label={`Name (${size})`}
          />
          <InlineNameInput
            size={size}
            value=""
            onCommit={() => {}}
            placeholder="Untitled dashboard"
            aria-label={`Empty name (${size})`}
          />
        </Stack>
      ))}
    </Stack>
  ),
};
