import type { Meta, StoryObj } from '@storybook/react';

import PasswordResetPage from './PasswordResetPage';

const meta = {
  component: PasswordResetPage,
} satisfies Meta<typeof PasswordResetPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Forgot = () => {
  return <PasswordResetPage action="forgot" />;
};

export const ResetPassword = () => {
  return <PasswordResetPage action="reset-password" />;
};
