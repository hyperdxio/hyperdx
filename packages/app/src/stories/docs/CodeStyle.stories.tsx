import codeStyle from '@agent-docs/code_style.md?raw';

import { AgentDoc } from './AgentDoc';

const story = {
  title: 'Guidelines/Code style',
  parameters: {
    layout: 'padded',
  },
};
export default story;

export const Documentation = () => <AgentDoc markdown={codeStyle} />;
