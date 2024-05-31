import type { Meta } from '@storybook/react';

import InstallInstructionsModal from './InstallInstructionsModal';

const meta = {
  component: InstallInstructionsModal,
} satisfies Meta<typeof InstallInstructionsModal>;

export default meta;

export const Default = () => {
  return <InstallInstructionsModal show onHide={() => {}} />;
};
