import { Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { SplitValueButton } from './SplitValueButton';

const meta: Meta<typeof SplitValueButton> = {
  title: 'Components/SplitValueButton',
  component: SplitValueButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The shared trigger for Group by, Columns, and Sort. Use it when a search control shows the current value of a clause and opens an editor. Do not use it for an action such as Save, Run, or Apply.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SplitValueButton>;

const noop = () => {};

export const WhenToUse: Story = {
  render: () => (
    <Stack gap="lg" maw={560}>
      <Text size="sm">
        Use this button for a search clause whose value is one field, or a count
        of fields. The name stays fixed. The value is what you press.
      </Text>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          Group by splits the histogram. One series for each value of the field.
        </Text>
        <SplitValueButton
          name="Group by"
          summary="SeverityText"
          count={1}
          compact={false}
          onClick={noop}
          data-testid="story-group-by"
        />
      </Stack>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          Columns chooses which columns the results table shows, and their
          order.
        </Text>
        <SplitValueButton
          name="Columns"
          summary="4 fields"
          count={4}
          compact={false}
          onClick={noop}
          data-testid="story-columns"
        />
      </Stack>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          Sort sets the order of the result rows. One field includes its
          direction.
        </Text>
        <SplitValueButton
          name="Sort"
          summary="Timestamp desc"
          count={1}
          compact={false}
          onClick={noop}
          data-testid="story-sort"
        />
      </Stack>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          On a narrow screen a count is only the number. One field keeps its
          name, and an empty clause stays none.
        </Text>
        <Group gap="sm">
          <SplitValueButton
            name="Group by"
            summary="SeverityText"
            count={1}
            compact
            onClick={noop}
            data-testid="story-group-by-compact"
          />
          <SplitValueButton
            name="Columns"
            summary="4 fields"
            count={4}
            compact
            onClick={noop}
            data-testid="story-columns-compact"
          />
          <SplitValueButton
            name="Sort"
            summary="none"
            count={0}
            dimmed
            compact
            onClick={noop}
            data-testid="story-sort-compact"
          />
        </Group>
      </Stack>
    </Stack>
  ),
};
