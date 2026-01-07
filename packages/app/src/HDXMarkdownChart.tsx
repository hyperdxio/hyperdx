import { memo } from 'react';
import ReactMarkdown from 'react-markdown';

import ChartContainer from './components/charts/ChartContainer';

const HDXMarkdownChart = memo(
  ({
    config: { markdown },
    title,
    toolbarItems,
  }: {
    title?: React.ReactNode;
    toolbarItems?: React.ReactNode[];
    config: {
      markdown?: string;
    };
  }) => {
    return (
      <ChartContainer
        title={title}
        toolbarItems={toolbarItems}
        disableReactiveContainer
      >
        <div className="hdx-markdown">
          <ReactMarkdown>{markdown ?? ''}</ReactMarkdown>
        </div>
      </ChartContainer>
    );
  },
);

export default HDXMarkdownChart;
