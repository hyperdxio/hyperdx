import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChartVariable } from '@hyperdx/common-utils/dist/types';
import { substituteVariables } from '@hyperdx/common-utils/dist/variables';

import ChartContainer from './components/charts/ChartContainer';

const HDXMarkdownChart = memo(
  ({
    config: { markdown },
    title,
    toolbarItems,
    variables,
  }: {
    title?: React.ReactNode;
    toolbarItems?: React.ReactNode[];
    config: {
      markdown?: string;
    };
    variables?: ChartVariable[];
  }) => {
    const content = useMemo(() => {
      if (!markdown || variables == null) return markdown ?? '';
      try {
        return substituteVariables(markdown, {
          variables,
          inputLanguage: 'markdown',
        });
      } catch {
        // An unknown `${name:format}` throws; show the markdown as written.
        return markdown;
      }
    }, [markdown, variables]);

    return (
      <ChartContainer
        title={title}
        toolbarItems={toolbarItems}
        disableReactiveContainer
      >
        <div className="hdx-markdown">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </ChartContainer>
    );
  },
);

export default HDXMarkdownChart;
