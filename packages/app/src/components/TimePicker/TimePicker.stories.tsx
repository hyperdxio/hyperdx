import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { TimePicker } from '@/components/TimePicker';

const meta = {
  component: TimePicker,
} satisfies Meta<typeof TimePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default = () => {
  const [value, setValue] = React.useState('Past 15m');

  return (
    <TimePicker
      inputValue={value}
      setInputValue={value => {
        setValue(value);
      }}
      onSearch={() => {}}
    />
  );
};
