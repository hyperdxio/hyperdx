import React from 'react';
import type { Meta } from '@storybook/react';

import { TooltipItem } from './HDXMultiSeriesTimeChart';

const meta: Meta = {
  title: 'TooltipItem',
  component: TooltipItem,
  parameters: {
    layout: 'centered',
  },
};

export const Default = () => (
  <div className="fs-8">
    <TooltipItem
      p={{
        dataKey: 'x',
        name: 'actually_pretty_long_name_but_should_be_truncated_eventually',
        value: 1,
        color: 'lightblue',
      }}
    />
    <TooltipItem
      p={{
        dataKey: 'x',
        name: 'actually_pretty_long_name_but_should_be_truncated_eventually',
        value: 1,
        color: 'lightblue',
        strokeDasharray: '5 5',
      }}
    />
  </div>
);

export default meta;
