import React from 'react';
import type { Meta } from '@storybook/nextjs';

import { TimePicker } from '@/components/TimePicker';

const meta = {
  component: TimePicker,
} satisfies Meta<typeof TimePicker>;

export default meta;

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
