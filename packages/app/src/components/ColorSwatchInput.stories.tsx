import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { ColorSwatchInput } from './ColorSwatchInput';

const meta = {
  component: ColorSwatchInput,
} satisfies Meta<typeof ColorSwatchInput>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default = () => {
  const [color, setColor] = React.useState<string | undefined>('#6610f2');

  return <ColorSwatchInput value={color} onChange={value => setColor(value)} />;
};
