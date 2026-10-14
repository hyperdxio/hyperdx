import namingObjects from '@agent-docs/naming_objects.md?raw';

import { AgentDoc } from './AgentDoc';

const story = {
  title: 'Guidelines/Naming objects',
  parameters: {
    layout: 'padded',
  },
};
export default story;

export const Documentation = () => <AgentDoc markdown={namingObjects} />;
