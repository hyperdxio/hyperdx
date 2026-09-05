import dataVizColors from '@agent-docs/data_viz_colors.md?raw';

import { AgentDoc } from './AgentDoc';

const story = {
  title: 'Guidelines/Data visualization colors',
  parameters: {
    layout: 'padded',
  },
};
export default story;

export const Documentation = () => <AgentDoc markdown={dataVizColors} />;
