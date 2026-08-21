import themes from '@agent-docs/themes.md?raw';

import { AgentDoc } from './AgentDoc';

const story = {
  title: 'Guidelines/Themes',
  parameters: {
    layout: 'padded',
  },
};
export default story;

export const Documentation = () => <AgentDoc markdown={themes} />;
