import type { Meta, StoryObj } from '@storybook/react';

import {
  AddSlackWebhookModal,
  ConfirmDeleteTeamMember,
  ConfirmRotateAPIKeyModal,
} from './TeamPageComponents';

const meta = {
  component: ConfirmRotateAPIKeyModal,
} satisfies Meta<typeof ConfirmRotateAPIKeyModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ConfirmRotateAPIKeyModalStory = () => {
  return <ConfirmRotateAPIKeyModal opened />;
};

export const AddSlackWebhookModalStory = () => {
  return <AddSlackWebhookModal opened />;
};

export const ConfirmDeleteTeamMemberStory = () => {
  return <ConfirmDeleteTeamMember opened email="ernest@hyperdx.io" />;
};
