import pageLayout from '@agent-docs/page_layout.md?raw';

import { AgentDoc } from './AgentDoc';

const story = {
  title: 'Guidelines/Page layout',
  parameters: {
    layout: 'padded',
  },
};
export default story;

export const Documentation = () => <AgentDoc markdown={pageLayout} />;
