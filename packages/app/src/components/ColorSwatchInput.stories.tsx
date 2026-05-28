import React from 'react';
import { Group, Stack, Text, TextInput } from '@mantine/core';
import type { Meta } from '@storybook/nextjs';

import {
  CATEGORICAL_PALETTE_TOKENS,
  ChartPaletteToken,
  SEMANTIC_PALETTE_TOKENS,
} from '@/utils';

import { ColorSwatchInput } from './ColorSwatchInput';

const meta = {
  title: 'ColorSwatchInput',
  component: ColorSwatchInput,
} satisfies Meta<typeof ColorSwatchInput>;

export default meta;

export const Default = () => {
  const [value, setValue] = React.useState<ChartPaletteToken | undefined>(
    undefined,
  );
  return <ColorSwatchInput value={value} onChange={setValue} />;
};

export const Selected = () => {
  const [value, setValue] = React.useState<ChartPaletteToken | undefined>(
    'chart-1',
  );
  return <ColorSwatchInput value={value} onChange={setValue} />;
};

export const Disabled = () => (
  <Group gap="md">
    <ColorSwatchInput disabled />
    <ColorSwatchInput value="chart-warning" disabled />
  </Group>
);

export const WithCustomLabel = () => {
  const [value, setValue] = React.useState<ChartPaletteToken | undefined>(
    undefined,
  );
  return (
    <ColorSwatchInput value={value} onChange={setValue} label="Series color" />
  );
};

/**
 * One trigger per token, all pre-selected. Renders the full matrix so the
 * design review can compare swatch sizes, hover states, and per-token
 * contrast across themes without opening the popover thirteen times.
 */
export const AllTokensSelected = () => (
  <Stack gap="xs">
    <Text size="sm" fw={500}>
      Categorical
    </Text>
    <Group gap="xs" wrap="wrap">
      {CATEGORICAL_PALETTE_TOKENS.map(token => (
        <ColorSwatchInput key={token} value={token} />
      ))}
    </Group>
    <Text size="sm" fw={500} mt="md">
      Semantic
    </Text>
    <Group gap="xs" wrap="wrap">
      {SEMANTIC_PALETTE_TOKENS.map(token => (
        <ColorSwatchInput key={token} value={token} />
      ))}
    </Group>
  </Stack>
);

/**
 * Picker mounted alongside other form controls so reviewers can verify
 * the focus order during keyboard nav (Tab into the picker, activate
 * with Enter or Space, Tab between swatches, Esc closes).
 */
export const KeyboardNav = () => {
  const [value, setValue] = React.useState<ChartPaletteToken | undefined>();
  return (
    <Stack gap="md" style={{ maxWidth: 380 }}>
      <TextInput
        label="Series name"
        defaultValue="errors"
        description="Tab from this input into the picker, activate, and pick a swatch."
      />
      <ColorSwatchInput value={value} onChange={setValue} />
      <TextInput label="Tab target after the picker" placeholder="next field" />
    </Stack>
  );
};
