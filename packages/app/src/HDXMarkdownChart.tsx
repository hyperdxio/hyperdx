import { memo } from 'react';
import ReactMarkdown from 'react-markdown';

const HDXMarkdownChart = memo(
  ({
    config: { markdown },
  }: {
    config: {
      markdown?: string;
    };
  }) => {
    return (
      <div className="HDXMarkdownChart">
        <ReactMarkdown>{markdown ?? ''}</ReactMarkdown>
      </div>
    );
  },
);

export default HDXMarkdownChart;
