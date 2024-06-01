import type { Meta } from '@storybook/react';
import type { StoryObj } from '@storybook/react';

import AppNav from '../AppNav';
import { AppNavUserMenu } from '../AppNav.components';

const meta: Meta = {
  component: AppNav,
  parameters: {
    layout: 'fullscreen',
  },
};

export const Default = () => <AppNav />;

export const AppNavUserMenuCmp: StoryObj = {
  args: {
    isCollapsed: false,
    logoutUrl: 'http://localhost/logout',
  },

  render: props => (
    <AppNavUserMenu
      userName="Ernest Iliiasov"
      teamName="HyperDX.io"
      {...props}
    />
  ),

  parameters: {
    layout: 'centered',
  },

  argTypes: {
    isCollapsed: {
      control: { type: 'boolean' },
    },
    logoutUrl: {
      control: { type: 'text' },
    },
  },
};

export default meta;
