import { memo } from 'react';
import ReactMarkdown from 'react-markdown';

const HDXMarkdownChart = memo(
  ({
    config: { content },
  }: {
    config: {
      content: string;
    };
  }) => {
    return (
      <div className="HDXMarkdownChart">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  },
);

export default HDXMarkdownChart;
